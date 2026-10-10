import ts from 'typescript';
import { rewriteColumnRefs } from './columnRefs.js';
import { type Context, createContext, instanceTypeOf, memberNames, type Owner, ownerOf } from './context.js';
import { appended, applyEdits, type Edit, inserted, original, type Part, replaced } from './edits.js';
import { columnExpressions, handNamedColumns, sqlTag, sqlWhereEdit, templateOf } from './entitySql.js';
import { fieldTypeFor, isBrandedString, relationTargetFor } from './fieldType.js';
import {
  clashingName,
  deadImportNames,
  LEGACY_SQL_TAG,
  reportRemovedExports,
  rewriteImports,
  SQL_TAG,
  sqlName,
  uqlExport,
  uqlImport,
  uqlImportDeclarations,
} from './imports.js';
import {
  type Edits,
  entityGetterTarget,
  fieldKeysEdits,
  isCallback,
  keyListEdits,
  mappedByEdits,
  memberAccess,
  paramFor,
  quoted,
  referencesEdits,
} from './keyMaps.js';
import { statementTemplate } from './statementSql.js';
import {
  arrayElements,
  decoratorName,
  decoratorsOf,
  identifierText,
  type NamedProperty,
  namedProperty,
  objectLiteral,
  objectProperties,
  propertyKey,
  propertyValue,
} from './syntax.js';

const FIELD_DECORATORS = new Set(['Field', 'Id']);
const RELATION_DECORATORS = new Set(['OneToOne', 'ManyToOne', 'OneToMany', 'ManyToMany']);
const TO_ONE_DECORATORS = new Set(['OneToOne', 'ManyToOne']);
const TO_ONE_CARDINALITIES = new Set(['11', 'm1']);

/**
 * Decorators that no longer exist, mapped to what to do instead. None is removed for you: what to put
 * in its place is a judgement call, and removing only the import would swap a clear error for a
 * puzzling one.
 */
const REMOVED_DECORATORS = new Map([
  ['Log', 'delete it and its import'],
  ['Serialized', 'delete it and its import'],
  ['Transactional', 'wrap the body in `pool.transaction(async (querier) => { ... })`'],
  ['InjectQuerier', 'take the querier from the enclosing `pool.transaction()` callback'],
]);

export type FileResult = {
  readonly fileName: string;
  readonly text: string;
  readonly changed: boolean;
  /** Properties the codemod refused to guess at, each needing a human. */
  readonly unresolved: readonly string[];
  /** Rewrites that are correct but worth a second look. */
  readonly notes: readonly string[];
};

/**
 * What the codemod can see of an options object. `opaque` is one it cannot write into without dropping what
 * the author put there: `@Field(shared)`, or `{ ...base }`, whose spread may carry the option and would win.
 */
type Options =
  | { readonly kind: 'empty'; readonly call: ts.CallExpression }
  | { readonly kind: 'literal'; readonly node: ts.ObjectLiteralExpression }
  | { readonly kind: 'opaque'; readonly reason: string };

/** The forms an option can be written into, which is what {@link insertOption} needs and nothing more. */
type WritableOptions = Extract<Options, { kind: 'empty' | 'literal' }>;

/** A decorator's options; `@Field` uncalled is opaque, since adding a call would guess it is the factory. */
function decoratorOptions(node: ts.Decorator): Options {
  if (!ts.isCallExpression(node.expression)) {
    return { kind: 'opaque', reason: 'it is used without being called' };
  }
  const [first] = node.expression.arguments;
  return first ? optionsOf(first) : { kind: 'empty', call: node.expression };
}

/** The options `value` writes: a literal to read and write into, or why it is not one. */
function optionsOf(value: ts.Expression): Options {
  if (!ts.isObjectLiteralExpression(value)) {
    return { kind: 'opaque', reason: `its options are passed as '${value.getText()}'` };
  }
  return value.properties.some(ts.isSpreadAssignment)
    ? { kind: 'opaque', reason: 'its options object spreads another' }
    : { kind: 'literal', node: value };
}

/** The option `name`, however its key is written: a stated option is left alone, and a renamed one moved. */
function findProperty(options: Options, name: string): NamedProperty | undefined {
  return options.kind === 'literal' ? namedProperty(options.node, name) : undefined;
}

/**
 * Renames the option `from` to `to`. Only the key is replaced, so the value, its formatting and any comment
 * inside survive; a shorthand has no value to keep, so it becomes `to: from`, since renaming the key alone
 * would rebind it to a local that does not exist.
 */
function renameOption(options: Options, from: string, to: string, node: ts.Node, ctx: Context): void {
  const property = findProperty(options, from);
  if (!property) {
    return;
  }
  if (findProperty(options, to)) {
    ctx.report(node, `gives both '${from}' and '${to}'; keep '${to}'.`);
    return;
  }
  ctx.edits.push(replaced(property.name, ts.isShorthandPropertyAssignment(property) ? `${to}: ${from}` : to));
}

/** {@link renameOption} for an option holding SQL - a field's `virtual`, a check's `expression` - noting that SQL. */
function renameSqlOption(options: Options, from: string, to: string, node: ts.Node, owner: Owner, ctx: Context): void {
  renameOption(options, from, to, node, ctx);
  if (options.kind === 'literal') {
    noteHandNamedColumns(propertyValue(options.node, from) ?? propertyValue(options.node, to), owner, ctx);
  }
}

/** Notes SQL that names a column by hand, which a rename does not reach. */
function noteHandNamedColumns(sql: ts.Expression | undefined, owner: Owner, ctx: Context): void {
  const names = sql ? handNamedColumns(sql, memberNames(owner.entity, ctx.checker), ctx.checker) : [];
  if (!sql || !names.length) {
    return;
  }
  ctx.note(
    sql,
    `SQL names ${names.map((name) => `'${name}'`).join(', ')} by hand, which a rename does not reach; ` +
      `read each off a callback's refs instead: (${owner.param}) => sql\`...\${${owner.param}.<member>}...\``,
  );
}

/** Inserts `option` into the decorator's options object, creating one in an empty argument list. */
function insertOption(options: WritableOptions, option: string): Edit {
  if (options.kind === 'empty') {
    const { arguments: args } = options.call;
    return { start: args.pos, end: args.end, text: `{ ${option} }` };
  }
  const first = options.node.properties[0];
  return first ? inserted(first, `${option}, `) : replaced(options.node, `{ ${option} }`);
}

/**
 * Writes one option the decorator can no longer infer at runtime, or records why it could not. Returns the
 * property's type where it wrote one, for the caller to say more about.
 */
function addInferredOption(
  decorator: ts.Decorator,
  node: ts.PropertyDeclaration,
  ctx: Context,
  spec: {
    readonly option: string;
    /** Options whose presence makes this one unnecessary. */
    readonly satisfiedBy: readonly string[];
    readonly infer: (type: ts.Type) => string | undefined;
  },
): ts.Type | undefined {
  const options = decoratorOptions(decorator);
  if (spec.satisfiedBy.some((name) => findProperty(options, name))) {
    return undefined;
  }
  if (options.kind === 'opaque') {
    ctx.report(node, `cannot add '${spec.option}' because ${options.reason}`);
    return undefined;
  }
  const type = ctx.checker.getTypeAtLocation(node);
  const value = spec.infer(type);
  if (!value) {
    ctx.report(node, `cannot infer '${spec.option}' for ${ctx.checker.typeToString(type)}`);
    return undefined;
  }
  ctx.edits.push(insertOption(options, `${spec.option}: ${value}`));
  return type;
}

/**
 * Writes the `type` that `design:type` supplied, unless `references` (the key it points at decides) or
 * `computed` does. A branded id erased to `String`, which keeps the column; `'uuid'` would change it, so that
 * is noted rather than decided.
 */
function addFieldType(decorator: ts.Decorator, node: ts.PropertyDeclaration, ctx: Context): void {
  const type = addInferredOption(decorator, node, ctx, {
    option: 'type',
    satisfiedBy: ['type', 'references', 'computed'],
    infer: fieldTypeFor,
  });
  if (type && isBrandedString(type)) {
    ctx.note(
      node,
      `set 'type: ${fieldTypeFor(type)}' for ${ctx.checker.typeToString(type)}, matching the previous behaviour. ` +
        "If the column should be 'uuid', change it deliberately: that alters the schema.",
    );
  }
}

/** Writes the `entity` getter relations can no longer infer. */
function addRelationEntity(decorator: ts.Decorator, node: ts.PropertyDeclaration, ctx: Context): void {
  addInferredOption(decorator, node, ctx, {
    option: 'entity',
    satisfiedBy: ['entity'],
    infer: (t) => {
      const target = relationTargetFor(t, ctx.checker);
      return target && `() => ${target}`;
    },
  });
}

/**
 * Names the foreign key a to-one used to find by name, `references: (post) => post.authorId` beside `author`.
 * `site` says where the entity declares its columns: the decorated property, ahead of which a missing column
 * is declared, or `defineEntity`'s `fields`. A column it cannot see declared is reported instead.
 */
function addForeignKeyReference(
  relation: ts.ObjectLiteralExpression,
  key: string | undefined,
  owner: Owner,
  ctx: Context,
  site?: ts.PropertyDeclaration | ts.ObjectLiteralExpression,
): void {
  const cardinality = propertyValue(relation, 'cardinality');
  const toOne = !cardinality || (ts.isStringLiteralLike(cardinality) && TO_ONE_CARDINALITIES.has(cardinality.text));
  const joined = ['mappedBy', 'through', 'references'].some((option) => namedProperty(relation, option));
  const last = relation.properties.at(-1);
  if (!key || !last || !toOne || joined) {
    return;
  }
  const column = `${key}Id`;
  const declaration = columnDeclaration(column, relation, owner, ctx.checker, site);
  if (typeof declaration === 'string') {
    ctx.report(site && ts.isPropertyDeclaration(site) ? site : relation, declaration);
    return;
  }
  if (declaration) {
    ctx.edits.push(declaration);
    ctx.imports.set('Field', 'the foreign key column');
  }
  ctx.edits.push(appended(last, `, references: (${owner.param}) => ${memberAccess(owner.param, column)}`));
}

const undeclaredColumn = (column: string) => `declare the foreign key column '${column}' and name it in 'references'`;

/** Nothing where `column` is declared, the declaration to write where a decorated class lacks it, or why neither. */
function columnDeclaration(
  column: string,
  relation: ts.ObjectLiteralExpression,
  owner: Owner,
  checker: ts.TypeChecker,
  site: ts.PropertyDeclaration | ts.ObjectLiteralExpression | undefined,
): Edit | string | undefined {
  const member = instanceTypeOf(owner.entity, checker).getProperty(column);
  if (site && ts.isPropertyDeclaration(site)) {
    if (!member) {
      return foreignKeyColumn(site, column, relation, checker);
    }
    return member.declarations?.some(isFieldProperty) ? undefined : undeclaredColumn(column);
  }
  const declared = site ? objectProperties(site).some(({ name }) => propertyKey(name) === column) : member;
  return declared ? undefined : undeclaredColumn(column);
}

/** `@Field({ references: () => Target }) <column>?: <key type> | null;` ahead of the relation, or why it cannot be written. */
function foreignKeyColumn(
  property: ts.PropertyDeclaration,
  column: string,
  relation: ts.ObjectLiteralExpression,
  checker: ts.TypeChecker,
): Edit | string {
  const targetType = checker.getNonNullableType(checker.getTypeAtLocation(property));
  const target = entityGetterTarget(relation) ?? relationTargetFor(targetType, checker);
  const keys = targetType.getProperties().filter((member) => member.declarations?.some(isIdProperty));
  if (keys.length > 1) {
    return `'${target}' has a composite key: declare a column per key and pair each in 'references'`;
  }
  const [key] = keys;
  if (!target || !key) {
    return undeclaredColumn(column);
  }
  const type = keyTypeSource(key, property, checker);
  return inserted(
    property,
    `@Field({ references: () => ${target} }) ${column}?: ${type} | null;\n${indentOf(property)}`,
  );
}

/** The whitespace a line starting at `node` is indented by. */
function indentOf(node: ts.Node): string {
  return ' '.repeat(node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).character);
}

/** The key's type as written where that is in scope, the same file, or as the checker spells it out. */
function keyTypeSource(key: ts.Symbol, at: ts.Node, checker: ts.TypeChecker): string {
  const written = key.declarations?.find(isIdProperty)?.type;
  if (written && written.getSourceFile() === at.getSourceFile()) {
    return written.getText();
  }
  return checker.typeToString(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(key, at)), at);
}

/** Whether a declaration is a property carrying one of `names` as a decorator. */
const decoratedWith =
  (names: ReadonlySet<string>) =>
  (node: ts.Declaration): node is ts.PropertyDeclaration =>
    ts.isPropertyDeclaration(node) && decoratorsOf(node).some((decorator) => names.has(decoratorName(decorator) ?? ''));

const isIdProperty = decoratedWith(new Set(['Id']));
const isFieldProperty = decoratedWith(FIELD_DECORATORS);

/**
 * Writes the edits `rewrite` reads off `value`, which still names members as strings, or reports it
 * where it could not be read: what it holds is only known at runtime. A callback or an object literal
 * is already the new form, and kept.
 */
function rewriteValue(
  value: ts.Expression | undefined,
  rewrite: (value: ts.Expression) => Edits,
  node: ts.Node,
  advice: string,
  ctx: Context,
): void {
  if (!value || isCallback(value) || ts.isObjectLiteralExpression(value)) {
    return;
  }
  const edits = rewrite(value);
  if (edits) {
    ctx.edits.push(...edits);
  } else {
    ctx.report(node, `${advice}; this one could not be read`);
  }
}

function rewriteKeyList(
  value: ts.Expression | undefined,
  param: string,
  node: ts.Node,
  what: string,
  ctx: Context,
): void {
  rewriteValue(value, (list) => keyListEdits(list, param), node, `write ${what} as a callback`, ctx);
}

/**
 * Rewrites a class's decorators - `@Index`, `@Filter` and `@Entity`'s options - for what they define now:
 * members named by string read off a callback's parameter named after the class, and SQL written as it is taken.
 */
function rewriteClassDecorators(node: ts.ClassLikeDeclaration, ctx: Context): void {
  const owner = ownerOf(node);
  for (const decorator of decoratorsOf(node)) {
    if (!ts.isCallExpression(decorator.expression)) {
      continue;
    }
    const [first, second] = decorator.expression.arguments;
    const name = decoratorName(decorator);
    const options = objectLiteral(first);
    if (name === 'Index') {
      rewriteIndex(first, second, owner, decorator, "'@Index' columns", ctx);
    } else if (name === 'Filter' && second) {
      renameOption(optionsOf(second), 'condition', 'where', decorator, ctx);
    } else if (name === 'Entity' && options) {
      rewriteEntityOptions(options, owner, ctx);
    }
  }
}

/**
 * Rewrites the imperative API the same way: `defineEntity(Post, { ... })`, `defineIndex(Post, { columns })`,
 * `defineRelation(Post, 'tag', { mappedBy, references })` and `defineFilter(Post, 'live', { condition })`.
 * Only uql's shapes, a class and a literal options object, are read.
 */
function rewriteDefineCall(call: ts.CallExpression, ctx: Context): void {
  const name = identifierText(call.expression);
  const [entity = call, second, third] = call.arguments;
  const owner = ownerOf(entity);
  const options = objectLiteral(second);
  const relation = objectLiteral(third);
  if (name === 'defineEntity' && options) {
    rewriteEntityOptions(options, owner, ctx);
  } else if (name === 'defineIndex' && options) {
    rewriteIndexOptions(options, owner, ctx);
  } else if (name === 'defineRelation' && relation) {
    rewriteRelationOptions(relation, owner.param, ctx);
    addForeignKeyReference(relation, second && ts.isStringLiteralLike(second) ? second.text : undefined, owner, ctx);
  } else if (name === 'defineFilter' && third) {
    renameOption(optionsOf(third), 'condition', 'where', call, ctx);
  }
}

function rewriteEntityOptions(options: ts.ObjectLiteralExpression, owner: Owner, ctx: Context): void {
  const fields = propertyValue(options, 'fields');
  for (const index of arrayElements(propertyValue(options, 'indexes'))) {
    if (ts.isObjectLiteralExpression(index)) {
      rewriteIndexOptions(index, owner, ctx);
    }
  }
  for (const check of arrayElements(propertyValue(options, 'checks'))) {
    renameSqlOption(optionsOf(check), 'expression', 'where', check, owner, ctx);
  }
  for (const field of objectProperties(fields)) {
    renameSqlOption(optionsOf(field.initializer), 'virtual', 'computed', field, owner, ctx);
    admitNullOnDefined(field, owner, ctx);
  }
  for (const filter of objectProperties(propertyValue(options, 'filters'))) {
    renameOption(optionsOf(filter.initializer), 'condition', 'where', filter, ctx);
  }
  for (const hook of objectProperties(propertyValue(options, 'hooks'))) {
    rewriteKeyList(hook.initializer, owner.param, hook, 'a hook list', ctx);
  }
  for (const relation of objectProperties(propertyValue(options, 'relations'))) {
    if (ts.isObjectLiteralExpression(relation.initializer)) {
      rewriteRelationOptions(relation.initializer, owner.param, ctx);
      addForeignKeyReference(relation.initializer, propertyKey(relation.name), owner, ctx, objectLiteral(fields));
    }
  }
}

function rewriteIndexOptions(index: ts.ObjectLiteralExpression, owner: Owner, ctx: Context): void {
  rewriteIndex(propertyValue(index, 'columns'), index, owner, index, "'columns'", ctx);
}

/**
 * An index, as `@Index(columns, options)` or a `defineIndex`/`indexes` entry holding both: its columns and
 * `include` read off the entity's refs, its `where` written as {@link rewriteIndexWhere} writes it, its SQL noted.
 */
function rewriteIndex(
  columns: ts.Expression | undefined,
  options: ts.Expression | undefined,
  owner: Owner,
  node: ts.Node,
  what: string,
  ctx: Context,
): void {
  const literal = objectLiteral(options);
  rewriteKeyList(columns, owner.param, node, what, ctx);
  rewriteKeyList(literal && propertyValue(literal, 'include'), owner.param, node, "'include'", ctx);
  rewriteIndexWhere(literal, ctx);
  for (const sql of [...columnExpressions(columns, ctx.checker), literal && propertyValue(literal, 'where')]) {
    noteHandNamedColumns(sql, owner, ctx);
  }
}

/** A partial-index `where` string as `sql`, on an entity and in the migration builder alike, or reported. */
function rewriteIndexWhere(options: ts.ObjectLiteralExpression | undefined, ctx: Context): void {
  const where = options && propertyValue(options, 'where');
  if (!where || !isStringTyped(ctx.checker.getTypeAtLocation(where))) {
    return;
  }
  const edit = sqlWhereEdit(where, sqlName(ctx.source));
  if (edit) {
    ctx.edits.push(edit);
    ctx.imports.set(SQL_TAG, 'the sql`...`');
  } else {
    ctx.report(where, "write the partial-index 'where' as sql`...` or a predicate; this one could not be read");
  }
}

/** Whether every value `type` admits is a string. */
function isStringTyped(type: ts.Type): boolean {
  return type.isUnion() ? type.types.every(isStringTyped) : Boolean(type.flags & ts.TypeFlags.StringLike);
}

/** The name of the method `call` calls where uql-orm declares it, so a `run` of another library's is left alone. */
function uqlMethod(call: ts.CallExpression, ctx: Context): string | undefined {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  const declarations = ctx.checker.getSymbolAtLocation(callee.name)?.declarations ?? [];
  const declared = declarations.some((it) => it.getSourceFile().fileName.includes('/node_modules/uql-orm/'));
  return declared ? callee.name.text : undefined;
}

/** A uql method whose shape or meaning changed: a querier's `run`/`all`, and `Migrator`'s `pending`, `executed`, `down`. */
function rewriteMethodCall(call: ts.CallExpression, ctx: Context): void {
  const method = uqlMethod(call, ctx);
  if (method === 'run' || method === 'all') {
    rewriteSqlCall(call, method, ctx);
  } else if (method === 'pending' || method === 'executed') {
    ctx.report(call, `'${method}()' was removed; read \`(await migrator.status()).${method}\``);
  } else if (method === 'down' && !call.arguments.length) {
    ctx.note(
      call,
      'down() with no options reverts only the last migration now; pass `{ step: Infinity }` to revert them all',
    );
  }
}

/**
 * A querier's `run`/`all` handed SQL as a string, which now takes a tagged statement: a literal becomes
 * `run`...``, its values interpolated where {@link statementTemplate} can place them, and SQL built at run
 * time `<sql>.text(...)`, which splices as the string did. Values it cannot place are reported.
 */
function rewriteSqlCall(call: ts.CallExpression, method: string, ctx: Context): void {
  const [sql, ...values] = call.arguments;
  if (!sql || !isStringTyped(ctx.checker.getTypeAtLocation(sql))) {
    return;
  }
  const template = statementTemplate(sql, values);
  if (template) {
    const typeArguments = (call.typeArguments ?? []).map(original);
    const listed = typeArguments.flatMap((type, at) => (at ? [', ', type] : [type]));
    const angle = typeArguments.length ? ['<', ...listed, '>'] : [];
    ctx.edits.push(replaced(call, [original(call.expression), ...angle, ...template]));
    return;
  }
  if (values.length) {
    ctx.report(
      call,
      `${method}() takes one statement: write the values into it, sql\`... \${value}\`, which binds them`,
    );
    return;
  }
  if (ts.isTemplateExpression(sql)) {
    ctx.note(call, 'the values in this template are spliced into the SQL; write it as sql`...` to bind them');
  }
  ctx.edits.push(replaced(sql, [`${sqlName(ctx.source)}.text(`, original(sql), ')']));
  ctx.imports.set(SQL_TAG, 'the sql.text(...)');
}

/** `const { id } = await q.upsertOne(...)`, which resolves to the id now, as the id: other keys are reported. */
function rewriteUpsertResult(declaration: ts.VariableDeclaration, ctx: Context): void {
  const { name, initializer } = declaration;
  const call = initializer && ts.isAwaitExpression(initializer) ? initializer.expression : initializer;
  if (!ts.isObjectBindingPattern(name) || !call || !ts.isCallExpression(call) || uqlMethod(call, ctx) !== 'upsertOne') {
    return;
  }
  const [element] = name.elements;
  const key = element && (element.propertyName ?? element.name);
  if (name.elements.length === 1 && key && identifierText(key) === 'id' && ts.isIdentifier(element.name)) {
    ctx.edits.push(replaced(name, element.name.text));
  } else {
    ctx.report(declaration, "upsertOne() resolves to the id; 'created' and 'changes' are gone");
  }
}

/** The migration builder's index methods, each with the position of the options it takes. */
const BUILDER_INDEX_METHODS: ReadonlyMap<string, number> = new Map([
  ['index', 1],
  ['unique', 1],
  ['addIndex', 1],
  ['createIndex', 2],
]);

/** The migration builder's `expr` helpers an entity imports as values under the same name, `now` renamed. */
const EXPR_VALUES: ReadonlyMap<string, string> = new Map([
  ['now', 'currentTimestamp'],
  ...['currentDate', 'currentTime', 'uuid', 'uuidv7'].map((name) => [name, name] as const),
]);

/**
 * Rewrites the migration builder's `expr.<helper>()` default as the value or `sql` an entity declares, or reports
 * one with no rewrite. Called only where the file imports `expr` from uql, so a variable of its own is left alone.
 */
function rewriteExprCall(call: ts.CallExpression, ctx: Context): void {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || identifierText(callee.expression) !== 'expr') {
    return;
  }
  const helper = callee.name.text;
  const value = EXPR_VALUES.get(helper);
  const [sql] = call.arguments;
  if (value) {
    ctx.edits.push(replaced(call, value));
    ctx.imports.set(value, `the expr.${helper}()`);
  } else if (helper === 'raw' && sql && ts.isStringLiteralLike(sql)) {
    ctx.edits.push(replaced(call, sqlTag(sqlName(ctx.source), sql.text)));
    ctx.imports.set(SQL_TAG, 'the sql`...`');
  } else {
    ctx.report(call, `expr.${helper}() is gone: declare the column with m.raw(...), or use a stamp on the entity`);
    return;
  }
  ctx.rewritten.expr += 1;
}

/** Rewrites the `where` of the migration builder's `t.index()`, `t.unique()`, `t.addIndex()` and `m.createIndex()`. */
function rewriteBuilderCall(call: ts.CallExpression, ctx: Context): void {
  const at = ts.isPropertyAccessExpression(call.expression)
    ? BUILDER_INDEX_METHODS.get(call.expression.name.text)
    : undefined;
  if (at !== undefined) {
    rewriteIndexWhere(objectLiteral(call.arguments[at]), ctx);
  }
}

const UPSERT_CALLS: ReadonlySet<string> = new Set(['upsertOne', 'upsertMany', 'upsertInto']);

/**
 * Rewrites an upsert's options holding `update` alone into that update, its fourth argument now. Read wherever it is
 * called, since a querier is seldom imported from uql where it is used. Any other fourth argument is already an
 * update, `{}` included, so a second run changes nothing.
 */
function rewriteUpsertCall(call: ts.CallExpression, ctx: Context): void {
  const callee = call.expression;
  const name = identifierText(ts.isPropertyAccessExpression(callee) ? callee.name : callee);
  const options = call.arguments[3];
  const update = options && upsertUpdate(options);
  if (name && UPSERT_CALLS.has(name) && update) {
    ctx.edits.push(replaced(options, [original(update)]));
  }
}

/** The value of options holding `update` alone, `{ update: value }` or `{ update }`. */
function upsertUpdate(options: ts.Expression): ts.Expression | undefined {
  const literal = objectLiteral(options);
  const property = literal?.properties.length === 1 ? namedProperty(literal, 'update') : undefined;
  return property && (ts.isPropertyAssignment(property) ? property.initializer : property.name);
}

/**
 * `owner` is the declaring class's parameter and `target` the related one's, read off the `entity`
 * getter unless the caller knows it from the property's type.
 */
function rewriteRelationOptions(
  relation: ts.ObjectLiteralExpression,
  owner: string,
  ctx: Context,
  target = paramFor(entityGetterTarget(relation)),
): void {
  const advice = (what: string) => `write '${what}' as a callback`;
  const mappedBy = (value: ts.Expression) => mappedByEdits(value, target);
  const references = (value: ts.Expression) => referencesEdits(value, owner, target);
  rewriteValue(propertyValue(relation, 'mappedBy'), mappedBy, relation, advice('mappedBy'), ctx);
  rewriteValue(propertyValue(relation, 'references'), references, relation, advice('references'), ctx);
}

/**
 * Rewrites a statement's keys: an aggregate's `$agg: { total: { $sum: 'amount' } }` into
 * `$select: { total: { $sum: { amount: true } } }`, `$text`'s `$fields: ['title']` into `{ title: true }`, and
 * `$lock`'s `wait` into `$wait`. Each key is uql's own, so it is read wherever a literal holds it.
 */
function rewriteStatementKeys(node: ts.PropertyAssignment, ctx: Context): void {
  const key = propertyKey(node.name);
  if (key === '$agg') {
    rewriteAggregate(node, ctx);
  } else if (key === '$fields' && isTextSearch(node.parent)) {
    rewriteValue(node.initializer, fieldKeysEdits, node, "write '$fields' as { field: true }", ctx);
  } else if (key === '$lock' && ts.isObjectLiteralExpression(node.initializer)) {
    rewriteLock(node.initializer, ctx);
  }
}

/** `{ wait: 'skip' }` as `{ $wait: 'skip' }`, and `{}` or a `'block'` wait as `true`, which waits. */
function rewriteLock(lock: ts.ObjectLiteralExpression, ctx: Context): void {
  const wait = propertyValue(lock, 'wait');
  const blocks = wait && ts.isStringLiteralLike(wait) && wait.text === 'block';
  if (!lock.properties.length || (blocks && lock.properties.length === 1)) {
    ctx.edits.push(replaced(lock, 'true'));
  } else {
    renameOption(optionsOf(lock), 'wait', '$wait', lock, ctx);
  }
}

function isTextSearch(node: ts.Node): boolean {
  return (
    ts.isObjectLiteralExpression(node) &&
    ts.isPropertyAssignment(node.parent) &&
    propertyKey(node.parent.name) === '$text'
  );
}

function rewriteAggregate(agg: ts.PropertyAssignment, ctx: Context): void {
  if (ts.isObjectLiteralExpression(agg.parent) && propertyValue(agg.parent, '$select')) {
    ctx.report(agg, "merge '$agg' into the '$select' beside it");
    return;
  }
  ctx.edits.push(replaced(agg.name, '$select'));
  for (const fn of objectProperties(agg.initializer)) {
    for (const op of objectProperties(fn.initializer)) {
      const isStar = ts.isStringLiteralLike(op.initializer) && op.initializer.text === '*';
      if (!isStar) {
        rewriteValue(op.initializer, fieldKeysEdits, op, `write '${op.name.getText()}' as { field: true }`, ctx);
      }
    }
  }
}

/**
 * Drops `declare` from a decorated field, with the whitespace after it: a `declare` field emits nothing, so
 * the standard spec has nothing to decorate and rejects it ("Decorators are not valid here").
 */
function dropDeclare(node: ts.PropertyDeclaration, ctx: Context): void {
  const modifier = node.modifiers?.find((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
  if (modifier) {
    const rest = node.getSourceFile().text.slice(modifier.getEnd());
    const end = modifier.getEnd() + rest.length - rest.trimStart().length;
    ctx.edits.push({ start: modifier.getStart(), end, text: '' });
  }
}

/**
 * Unwraps `Relation<Company>` to `Company`. The alias is `type Relation<T> = T`, and it existed only
 * because reflection stored the property's type at class-definition time, which forced a real import and
 * so created the circular-import problem it was working around.
 */
function unwrapRelationAlias(node: ts.PropertyDeclaration, ctx: Context): void {
  const declared = node.type;
  if (
    declared &&
    ts.isTypeReferenceNode(declared) &&
    identifierText(declared.typeName) === 'Relation' &&
    declared.typeArguments?.length === 1
  ) {
    ctx.edits.push(replaced(declared, [original(declared.typeArguments[0])]));
    ctx.rewritten.Relation += 1;
  }
}

/** The names a key is read from without help, mirroring `NamedIdKey` in `uql-orm`. */
const CONVENTIONAL_ID_NAMES = new Set(['id', '_id', 'uuid']);

/** Whether the member is an `[idKey]?: ...` brand, matched by the name it is written under. */
function isIdKeyBrand(member: ts.ClassElement): boolean {
  return (
    ts.isPropertyDeclaration(member) &&
    ts.isComputedPropertyName(member.name) &&
    identifierText(member.name.expression) === 'idKey'
  );
}

/**
 * Names the class's key with the `idKey` brand where a conventional name does not. Only the class's own `@Id`
 * properties are read: a subclass replacing an inherited `id` needs the brand, or that name is taken for the key.
 */
function brandIdKey(node: ts.ClassLikeDeclaration, ctx: Context): void {
  const ids = node.members.filter(isIdProperty);
  if (!ids.length || node.members.some(isIdKeyBrand)) {
    return;
  }
  const names = ids.map((m) => propertyKey(m.name)).filter((name) => name !== undefined);
  if (names.length !== ids.length) {
    ctx.report(node, "a key written as a computed name; add the 'idKey' brand by hand");
    return;
  }
  if (names.length === 1 && CONVENTIONAL_ID_NAMES.has(names[0])) {
    return;
  }
  const start = node.members.pos;
  ctx.edits.push({ start, end: start, text: `\n${indentOf(ids[0])}[idKey]?: ${names.map(quoted).join(' | ')};` });
  ctx.imports.set('idKey', 'the brand(s)');
}

/**
 * Everything the standard spec needs written onto one decorated property, and the options renamed since.
 * Options it cannot read may still hold `virtual`, so they are reported where they mention it.
 */
function rewriteProperty(node: ts.PropertyDeclaration, ctx: Context): void {
  const owner = ownerOf(node.parent);
  const decorators = decoratorsOf(node);
  for (const decorator of decorators) {
    const name = decoratorName(decorator) ?? '';
    const options = decoratorOptions(decorator);
    if (FIELD_DECORATORS.has(name)) {
      if (name === 'Field') {
        admitNull(options, node, ctx);
      }
      addFieldType(decorator, node, ctx);
      if (options.kind === 'opaque' && /\bvirtual\b/.test(decorator.getText())) {
        ctx.report(node, options.reason);
      }
      renameSqlOption(options, 'virtual', 'computed', node, owner, ctx);
    }
    if (RELATION_DECORATORS.has(name)) {
      addRelationEntity(decorator, node, ctx);
      if (options.kind === 'literal') {
        const target = relationTargetFor(ctx.checker.getTypeAtLocation(node), ctx.checker);
        rewriteRelationOptions(options.node, owner.param, ctx, paramFor(target));
      }
      if (options.kind === 'literal' && TO_ONE_DECORATORS.has(name)) {
        addForeignKeyReference(options.node, propertyKey(node.name), owner, ctx, node);
      }
    }
  }
  if (decorators.length) {
    dropDeclare(node, ctx);
  }
  unwrapRelationAlias(node, ctx);
}

/**
 * A column holds `null` unless `nullable: false` says otherwise, so the property says so too. A key is NOT NULL
 * everywhere and a relation aggregate types its own, so neither is touched; nor are options it cannot read,
 * which may state `nullable` and are reported by {@link addFieldType} already.
 */
function admitNull(options: Options, node: ts.PropertyDeclaration, ctx: Context): void {
  if (
    options.kind === 'opaque' ||
    !ctx.strictNullChecks ||
    declaresNotNull(options) ||
    findProperty(options, 'isId') ||
    (findProperty(options, 'computed') && !findProperty(options, 'type'))
  ) {
    return;
  }
  if (!node.type) {
    ctx.note(node, `declare '${propertyKey(node.name)}' as a type that admits 'null', which the column holds`);
  } else if (!admitsNull(node.type)) {
    ctx.edits.push(appended(node.type, ' | null'));
  }
}

/** The same null rule where `defineEntity` names the field, on the property of the class the call takes. */
function admitNullOnDefined(field: ts.PropertyAssignment, owner: Owner, ctx: Context): void {
  const key = propertyKey(field.name);
  const declaration = key
    ? instanceTypeOf(owner.entity, ctx.checker)
        .getProperty(key)
        ?.declarations?.find((it) => ts.isPropertyDeclaration(it))
    : undefined;
  if (declaration?.type) {
    admitNull(optionsOf(field.initializer), declaration, ctx);
  }
}

/** Whether the options say the column refuses `null`; `nullable: true` is the default said out loud. */
function declaresNotNull(options: Options): boolean {
  const nullable = findProperty(options, 'nullable');
  return !!nullable && ts.isPropertyAssignment(nullable) && nullable.initializer.kind === ts.SyntaxKind.FalseKeyword;
}

/**
 * Whether a written type already admits `null`, wherever it sits in the union. In a type position `null`
 * parses as a literal type rather than a keyword, which is why the kind is read off `literal`.
 */
function admitsNull(type: ts.TypeNode): boolean {
  if (ts.isLiteralTypeNode(type)) {
    return type.literal.kind === ts.SyntaxKind.NullKeyword;
  }
  return ts.isUnionTypeNode(type) && type.types.some(admitsNull);
}

/** Names a decorator that no longer exists, wherever it appears. */
function reportRemovedDecorators(node: ts.Node, ctx: Context): void {
  for (const decorator of decoratorsOf(node)) {
    const name = decoratorName(decorator);
    const advice = name && REMOVED_DECORATORS.get(name);
    if (advice) {
      ctx.report(decorator, `'@${name}()' was removed; ${advice}`);
    }
  }
}

/**
 * Rewrites the deprecated `raw('...')` into the `sql` tagged template, and a second alias argument into `.as()`, the
 * callback form's included. A computed string is left alone: a template cannot be built from a value not known here.
 */
function rewriteRawCall(node: ts.Node, ctx: Context): void {
  if (!ts.isCallExpression(node) || uqlExport(node.expression, ctx.checker) !== LEGACY_SQL_TAG) {
    return;
  }
  const [expression, alias] = node.arguments;
  if (!expression || node.arguments.length > 2) {
    return;
  }
  const suffix: readonly Part[] = alias ? ['.as(', original(alias), ')'] : [];
  if (ts.isStringLiteral(expression)) {
    ctx.edits.push(replaced(node, [original(node.expression), templateOf(expression.text), ...suffix]));
  } else if (alias) {
    ctx.edits.push({ start: expression.getEnd(), end: node.getEnd(), text: [')', ...suffix] });
  }
}

/**
 * Rewrites one source file for the standard decorator spec. The builder's and querier's methods are known by
 * name, so they are read only in a file importing uql-orm, and `expr` only where it is uql's.
 */
export function transformFile(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  options: { readonly strictNullChecks: boolean } = { strictNullChecks: true },
): FileResult {
  const ctx = createContext(source, checker, options.strictNullChecks);
  const importsUql = uqlImportDeclarations(source, true).length > 0;
  const importsExpr = uqlImport(source, 'expr', true) !== undefined;
  const importsRaw = uqlImport(source, LEGACY_SQL_TAG, true) !== undefined;

  const visit = (node: ts.Node): void => {
    reportRemovedDecorators(node, ctx);
    if (importsRaw) {
      rewriteRawCall(node, ctx);
    }
    if (ts.isPropertyDeclaration(node)) {
      rewriteProperty(node, ctx);
    }
    if (ts.isClassLike(node)) {
      brandIdKey(node, ctx);
      rewriteClassDecorators(node, ctx);
    }
    if (ts.isCallExpression(node)) {
      rewriteDefineCall(node, ctx);
      rewriteUpsertCall(node, ctx);
      if (importsUql) {
        rewriteBuilderCall(node, ctx);
        rewriteMethodCall(node, ctx);
      }
      if (importsExpr) {
        rewriteExprCall(node, ctx);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      rewriteStatementKeys(node, ctx);
    }
    if (importsUql && ts.isVariableDeclaration(node)) {
      rewriteUpsertResult(node, ctx);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const clash = clashingName(ctx);
  if (clash) {
    ctx.report(clash, `'${clash.text}' is already named here, and the codemod writes it: rename that, then run again`);
    return fileResult(ctx, source.getFullText());
  }
  const dead = new Set([...deadImportNames(ctx), ...rewriteColumnRefs(ctx)]);
  rewriteImports(dead, ctx);
  reportRemovedExports(ctx);

  return fileResult(ctx, applyEdits(source.getFullText(), ctx.edits));
}

function fileResult({ source, unresolved, notes }: Context, text: string): FileResult {
  return { fileName: source.fileName, text, changed: text !== source.getFullText(), unresolved, notes };
}
