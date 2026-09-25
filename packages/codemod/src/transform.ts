import ts from 'typescript';
import { appended, applyEdits, type Edit, inserted, removeFromList, replaced } from './edits.js';
import { columnExpressions, handNamedColumns, isRaw, rawTag, rawWhereEdit } from './entitySql.js';
import { fieldTypeFor, isBrandedString, relationTargetFor } from './fieldType.js';
import {
  type Edits,
  entityGetterTarget,
  fieldKeysEdits,
  isCallback,
  keyListEdits,
  mappedByEdits,
  memberAccess,
  paramFor,
  propertyKey,
  propertyValue,
  quoted,
  referencesEdits,
} from './keyMaps.js';

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

/**
 * Exports that no longer exist, mapped to what to do instead. Reported rather than rewritten, for the
 * same reason as the decorators: what replaces each is decided at its call site.
 */
const REMOVED_EXPORTS = new Map([
  [
    'setQuerierPool',
    'pass the pool where it is used: `createFetchHandler({ pool, include })`, `querierMiddleware({ pool, include })`',
  ],
  ['getQuerierPool', 'take the pool from the module that builds it, or from Nest DI'],
  ['getQuerier', 'use `pool.withQuerier(...)` / `pool.transaction(...)`, which release the connection'],
  ['QueryWhereFieldMap', 'use `QueryWhere`'],
  ['QueryStreamProjected', 'use `QueryProjected`'],
  ['RelationMappedBy', "a 'mappedBy' is `(keys: KeyMap<E>) => Key<E>` now"],
  ['RelationKeyMapper', 'it is `(keys: KeyMap<E>) => Key<E>` now'],
  ['augmentWhere', 'spread the two maps: `{ ...where, ...extra }`'],
  ['buildQueryWhereAsMap', 'a `$where` is a map already; name the key for ids: `{ id: [1, 2] }`'],
  ['AbstractPgQuerier', 'every pg-compatible pool returns `PgQuerier` (`uql-orm/postgres`), which is concrete'],
  ['AbstractHranaQuerierPool', 'extend `AbstractSqlQuerierPool` and hand every querier a `HranaQuerier`'],
  [
    'PreparedSqliteQuerier',
    'use `SqliteQuerier`, which takes any driver that prepares, or extend `AbstractSqliteQuerier`',
  ],
  ['toSqliteBindValues', 'pass the values as they are: every SQLite driver binds a `SqliteBindValue[]`'],
  ['libsqlUseRemoteForMigrations', '`LibsqlQuerierPool.getMigrationQuerier()` decides it'],
  ['SqlCallback', 'use `EntitySql<E>`, which holds the callback form'],
  [
    'IndexColumnOptions',
    "an entity's index entry is `EntityIndexColumnInput<E>`, the migration builder's `IndexColumnInput`",
  ],
  ['isKnownMigratorDialect', 'every dialect has a migrator, so it always held: drop the check'],
  ['QuerierPoolDialect', "read the pool's own: `P['dialect']`"],
  ['QuerierPoolQuerier', "read the pool's own: `Awaited<ReturnType<P['getQuerier']>>`"],
  [
    'POSTGRES_WIRE_DRIVER_CAPABILITIES',
    'pass `driverCapabilities: { nativeArrays: false, explicitJsonCast: true }` to the dialect',
  ],
  ['MysqlLikeSqlDialect', 'extend `MySqlDialect` (`uql-orm/mysql`) or `MariaDialect` (`uql-orm/maria`)'],
  ['D1Meta', "uql reads `D1Result['meta']`; the rest of a binding is typed by `@cloudflare/workers-types`"],
  ['D1ExecResult', 'the rest of a binding is typed by `@cloudflare/workers-types`'],
  ['createSchemaGenerator', 'use `new SqlSchemaGenerator(dialect)`, or `migrator.getSchemaGenerator()`'],
]);

/**
 * Exports renamed and nothing else - the driver classes were empty subclasses - so the import and every
 * use follow, the import moving to `from` where the new name lives in another entry.
 */
const RENAMED_EXPORTS = new Map<string, { readonly to: string; readonly from?: string }>([
  ['QueryWhereMap', { to: 'QueryWhere' }],
  ['RelationKeyMap', { to: 'KeyMap' }],
  ['FilterCondition', { to: 'FilterWhere' }],
  ['PgDialect', { to: 'PostgresDialect', from: 'uql-orm/postgres' }],
  ['NeonDialect', { to: 'PostgresDialect', from: 'uql-orm/postgres' }],
  ['PgliteDialect', { to: 'PostgresDialect', from: 'uql-orm/postgres' }],
  ['CrdbQuerier', { to: 'PgQuerier', from: 'uql-orm/postgres' }],
  ['NeonQuerier', { to: 'PgQuerier', from: 'uql-orm/postgres' }],
  ['MySql2Dialect', { to: 'MySqlDialect', from: 'uql-orm/mysql' }],
  ['MongodbNativeDialect', { to: 'MongoDialect', from: 'uql-orm/mongo' }],
  ['LibsqlQuerier', { to: 'HranaQuerier', from: 'uql-orm/sqlite' }],
  ['TursoQuerier', { to: 'HranaQuerier', from: 'uql-orm/sqlite' }],
  ['TursoLocalQuerier', { to: 'SqliteQuerier', from: 'uql-orm/sqlite' }],
  ['TursoDatabase', { to: 'SqliteDatabase', from: 'uql-orm/sqlite' }],
  ['SqlMigrationModuleOptions', { to: 'MigrationModuleOptions' }],
  ['buildSqlQuerierMigrationModule', { to: 'buildMigrationModule' }],
  ['QueryDialect', { to: 'SqlQueryDialect' }],
  ['EngineFeatures', { to: 'DialectFeatures' }],
  ['KnownMigratorDialect', { to: 'DialectName', from: 'uql-orm' }],
  ['D1Preparer', { to: 'D1Queryable' }],
  ['D1Database', { to: 'D1Queryable', from: 'uql-orm/d1' }],
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

/** A node's decorators, or none where it is a kind that cannot carry them. */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorName(node: ts.Decorator): string | undefined {
  const call = ts.isCallExpression(node.expression) ? node.expression : undefined;
  const target = call?.expression ?? node.expression;
  return ts.isIdentifier(target) ? target.text : undefined;
}

/**
 * What the codemod can see of an options object.
 *
 * `opaque` is the case that matters: `@Field(shared)` passes an options object the codemod cannot read,
 * and writing into it would mean replacing the argument, silently dropping whatever the author put
 * there. A spread is opaque for the same reason - `{ ...base }` may already carry the option, and
 * inserting before it lets the spread win anyway.
 */
type Options =
  | { readonly kind: 'empty'; readonly call: ts.CallExpression }
  | { readonly kind: 'literal'; readonly node: ts.ObjectLiteralExpression }
  | { readonly kind: 'opaque'; readonly reason: string };

/** The forms an option can be written into, which is what {@link insertOption} needs and nothing more. */
type WritableOptions = Extract<Options, { kind: 'empty' | 'literal' }>;

function decoratorOptions(node: ts.Decorator): Options {
  if (!ts.isCallExpression(node.expression)) {
    // `@Field` rather than `@Field()`: there is no argument list to write into, and adding one would mean
    // guessing that this is the decorator factory the codemod thinks it is.
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

/** A named property of the options object, however its key is written. */
type NamedProperty = ts.PropertyAssignment | ts.ShorthandPropertyAssignment;

/**
 * The property `name` in the options, whether its key is plain, quoted or a shorthand.
 *
 * All three forms, because both callers care about the option being *there*: one to leave an option
 * alone that is already stated, the other to rename it. Matching only the plain key inserted a second
 * `type` beside a quoted one, and left a shorthand `virtual` behind while reporting nothing.
 */
function findProperty(options: Options, name: string): NamedProperty | undefined {
  if (options.kind !== 'literal') {
    return undefined;
  }
  return options.node.properties.find(
    (prop): prop is NamedProperty =>
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && propertyKey(prop.name) === name,
  );
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
    ctx.unresolved.push(`${ctx.describe(node)}: gives both '${from}' and '${to}'; keep '${to}'.`);
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
  const names = sql ? handNamedColumns(sql, memberNames(owner.entity, ctx.checker)) : [];
  if (!sql || !names.length) {
    return;
  }
  ctx.notes.push(
    `${ctx.describe(sql)}: SQL names ${names.map((name) => `'${name}'`).join(', ')} by hand, which a rename ` +
      `does not reach; read each off a callback's refs instead: (${owner.param}) => raw\`...\${${owner.param}.<member>}...\``,
  );
}

/** The names of the members of the entity `node` declares or names. */
function memberNames(node: ts.Node, checker: ts.TypeChecker): ReadonlySet<string> {
  return propertyNames(instanceTypeOf(node, checker));
}

/** The instance type of the entity `node` declares or names. */
function instanceTypeOf(node: ts.Node, checker: ts.TypeChecker): ts.Type {
  const type = checker.getTypeAtLocation(node);
  return type.getConstructSignatures()[0]?.getReturnType() ?? type;
}

function propertyNames(type: ts.Type): ReadonlySet<string> {
  return new Set(type.getProperties().map(({ name }) => name));
}

/** Inserts `option` into the decorator's options object, creating one when the call has no arguments. */
function insertOption(options: WritableOptions, option: string): Edit {
  if (options.kind === 'empty') {
    // `@Field()` -> `@Field({ ... })`: the argument list is empty, so this only ever inserts.
    const { arguments: args } = options.call;
    return { start: args.pos, end: args.end, text: `{ ${option} }` };
  }
  const first = options.node.properties[0];
  return first ? inserted(first, `${option}, `) : replaced(options.node, `{ ${option} }`);
}

type Context = {
  readonly checker: ts.TypeChecker;
  readonly edits: Edit[];
  readonly unresolved: string[];
  readonly notes: string[];
  /** Names written that the file has to import from `uql-orm`, each with what it was written for. */
  readonly imports: Map<string, string>;
  /** `Relation<T>` references seen, and how many were unwrapped, which decides whether its import goes. */
  readonly relationAlias: { seen: number; unwrapped: number };
  readonly describe: (node: ts.Node) => string;
};

/** The entity a definition describes: the parameter its callbacks are named after, and the node naming it. */
type Owner = { readonly param: string; readonly entity: ts.Node };

/**
 * Writes one option the decorator can no longer infer at runtime, or records why it could not.
 *
 * Returns the property's type when an edit was written, so a caller can say something about what was
 * just decided. Nothing is written for options the codemod cannot read: replacing them would drop
 * whatever the author put there.
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
    ctx.unresolved.push(`${ctx.describe(node)}: cannot add '${spec.option}' because ${options.reason}`);
    return undefined;
  }

  const type = ctx.checker.getTypeAtLocation(node);
  const value = spec.infer(type);
  if (!value) {
    ctx.unresolved.push(`${ctx.describe(node)}: cannot infer '${spec.option}' for ${ctx.checker.typeToString(type)}`);
    return undefined;
  }
  ctx.edits.push(insertOption(options, `${spec.option}: ${value}`));
  return type;
}

/** Writes the `type` that `design:type` used to supply at runtime. */
function addFieldType(decorator: ts.Decorator, node: ts.PropertyDeclaration, ctx: Context): void {
  const type = addInferredOption(decorator, node, ctx, {
    option: 'type',
    // A `references` field deliberately has no `type`: the column resolves from the primary key it
    // points at, which also carries that key's `columnType` and length.
    satisfiedBy: ['type', 'references'],
    infer: fieldTypeFor,
  });

  // A branded id type (`type UUID = `${string}-${string}-...``) erased to `String` under reflection, so
  // `String` is what keeps the existing column. It is often not what was wanted, though, and switching
  // to `'uuid'` changes the generated column, so say so rather than decide.
  if (type && isBrandedString(type)) {
    ctx.notes.push(
      `${ctx.describe(node)}: set 'type: ${fieldTypeFor(type)}' for ` +
        `${ctx.checker.typeToString(type)}, matching the previous behaviour. If the column should be ` +
        "'uuid', change it deliberately: that alters the schema.",
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
  const options: Options = { kind: 'literal', node: relation };
  const cardinality = propertyValue(relation, 'cardinality');
  const toOne = !cardinality || (ts.isStringLiteralLike(cardinality) && TO_ONE_CARDINALITIES.has(cardinality.text));
  const joined = ['mappedBy', 'through', 'references'].some((option) => findProperty(options, option));
  const last = relation.properties.at(-1);
  if (!key || !last || !toOne || joined) {
    return;
  }
  const column = `${key}Id`;
  const declaration = columnDeclaration(column, relation, owner, ctx.checker, site);
  if (typeof declaration === 'string') {
    ctx.unresolved.push(`${ctx.describe(site && ts.isPropertyDeclaration(site) ? site : relation)}: ${declaration}`);
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

/** `@Field({ references: () => Target }) <column>?: <key type>;` ahead of the relation, or why it cannot be written. */
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
  const indent = ' '.repeat(property.getSourceFile().getLineAndCharacterOfPosition(property.getStart()).character);
  const type = keyTypeSource(key, property, checker);
  // `| null`, as on every column the codemod touches: a foreign key holds one like any other.
  return inserted(property, `@Field({ references: () => ${target} }) ${column}?: ${type} | null;\n${indent}`);
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
    ctx.unresolved.push(`${ctx.describe(node)}: ${advice}; this one could not be read`);
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
function rewriteClassDecorators(node: ts.ClassDeclaration | ts.ClassExpression, ctx: Context): void {
  const owner: Owner = { param: paramFor(node.name?.text), entity: node };
  for (const decorator of decoratorsOf(node)) {
    if (!ts.isCallExpression(decorator.expression)) {
      continue;
    }
    const [first, second] = decorator.expression.arguments;
    const name = decoratorName(decorator);
    if (name === 'Index') {
      rewriteIndex(first, second, owner, decorator, "'@Index' columns", ctx);
    } else if (name === 'Filter' && second) {
      renameOption(optionsOf(second), 'condition', 'where', decorator, ctx);
    } else if (name === 'Entity' && first && ts.isObjectLiteralExpression(first)) {
      rewriteEntityOptions(first, owner, ctx);
    }
  }
}

/**
 * Rewrites the imperative API the same way: `defineEntity(Post, { ... })`, `defineIndex(Post, { columns })`,
 * `defineRelation(Post, 'tag', { mappedBy, references })` and `defineFilter(Post, 'live', { condition })`.
 * Only uql's shapes, a class and a literal options object, are read.
 */
function rewriteDefineCall(call: ts.CallExpression, ctx: Context): void {
  const name = ts.isIdentifier(call.expression) ? call.expression.text : undefined;
  const [entity = call, second, third] = call.arguments;
  const owner: Owner = { param: paramFor(ts.isIdentifier(entity) ? entity.text : undefined), entity };
  if (name === 'defineEntity' && second && ts.isObjectLiteralExpression(second)) {
    rewriteEntityOptions(second, owner, ctx);
  } else if (name === 'defineIndex' && second && ts.isObjectLiteralExpression(second)) {
    rewriteIndexOptions(second, owner, ctx);
  } else if (name === 'defineRelation' && third && ts.isObjectLiteralExpression(third)) {
    rewriteRelationOptions(third, owner.param, ctx);
    addForeignKeyReference(third, second && ts.isStringLiteralLike(second) ? second.text : undefined, owner, ctx);
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
  const declared = fields && ts.isObjectLiteralExpression(fields) ? fields : undefined;
  for (const relation of objectProperties(propertyValue(options, 'relations'))) {
    if (ts.isObjectLiteralExpression(relation.initializer)) {
      rewriteRelationOptions(relation.initializer, owner.param, ctx);
      addForeignKeyReference(relation.initializer, propertyKey(relation.name), owner, ctx, declared);
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
  const literal = options && ts.isObjectLiteralExpression(options) ? options : undefined;
  rewriteKeyList(columns, owner.param, node, what, ctx);
  rewriteKeyList(literal && propertyValue(literal, 'include'), owner.param, node, "'include'", ctx);
  rewriteIndexWhere(literal, ctx);
  for (const sql of [...columnExpressions(columns), literal && propertyValue(literal, 'where')]) {
    noteHandNamedColumns(sql, owner, ctx);
  }
}

/**
 * A partial-index `where` string as `raw`, on an entity and in the migration builder alike. A string it
 * cannot write as `raw` is reported.
 */
function rewriteIndexWhere(options: ts.ObjectLiteralExpression | undefined, ctx: Context): void {
  const where = options && propertyValue(options, 'where');
  if (!where || !isStringTyped(ctx.checker.getTypeAtLocation(where))) {
    return;
  }
  const edit = rawWhereEdit(where);
  if (edit) {
    ctx.edits.push(edit);
    ctx.imports.set('raw', 'the raw`...`');
  } else {
    ctx.unresolved.push(
      `${ctx.describe(where)}: write the partial-index 'where' as raw\`...\` or a predicate; this one could not be read`,
    );
  }
}

/** Whether every value `type` admits is a string. */
function isStringTyped(type: ts.Type): boolean {
  return type.isUnion() ? type.types.every(isStringTyped) : Boolean(type.flags & ts.TypeFlags.StringLike);
}

/** The migration builder's index methods, each with the position of the options it takes. */
const BUILDER_INDEX_METHODS: ReadonlyMap<string, number> = new Map([
  ['index', 1],
  ['unique', 1],
  ['addIndex', 1],
  ['createIndex', 2],
]);

/** Rewrites the `where` of the migration builder's `t.index()`, `t.unique()`, `t.addIndex()` and `m.createIndex()`. */
function rewriteBuilderCall(call: ts.CallExpression, ctx: Context): void {
  const at = ts.isPropertyAccessExpression(call.expression)
    ? BUILDER_INDEX_METHODS.get(call.expression.name.text)
    : undefined;
  if (at === undefined) {
    return;
  }
  const options = call.arguments[at];
  rewriteIndexWhere(options && ts.isObjectLiteralExpression(options) ? options : undefined, ctx);
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
    ctx.unresolved.push(`${ctx.describe(agg)}: merge '$agg' into the '$select' beside it`);
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

/** The property assignments of an object literal, or none where `node` is not one. */
function objectProperties(node: ts.Expression | undefined): readonly ts.PropertyAssignment[] {
  return node && ts.isObjectLiteralExpression(node) ? node.properties.filter(ts.isPropertyAssignment) : [];
}

/** The elements of an array literal, or none where `node` is not one. */
function arrayElements(node: ts.Expression | undefined): readonly ts.Expression[] {
  return node && ts.isArrayLiteralExpression(node) ? node.elements : [];
}

/**
 * Drops `declare` from a decorated field. A `declare` field emits nothing, so the standard spec has
 * nothing to decorate and rejects it ("Decorators are not valid here"). Legacy decorators tolerated it
 * because they only ever reached the class through `target.constructor`.
 */
function dropDeclare(node: ts.PropertyDeclaration, ctx: Context): void {
  const modifier = node.modifiers?.find((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
  if (modifier) {
    // Through the whitespace that followed it, rather than a fixed one character: two spaces or a line
    // break left the rest behind.
    const text = node.getSourceFile().text;
    let end = modifier.getEnd();
    while (/\s/.test(text[end])) {
      end += 1;
    }
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
    ts.isIdentifier(declared.typeName) &&
    declared.typeName.text === 'Relation' &&
    declared.typeArguments?.length === 1
  ) {
    ctx.edits.push(replaced(declared, declared.typeArguments[0].getText()));
    ctx.relationAlias.unwrapped += 1;
  }
}

/** Counts `Relation<T>` wherever it appears, including the places this codemod does not rewrite. */
function countRelationAlias(node: ts.Node, ctx: Context): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Relation') {
    ctx.relationAlias.seen += 1;
  }
}

/** Removes a statement together with the rest of its line, so nothing is left blank behind it. */
function removeStatement(node: ts.Node): Edit {
  const source = node.getSourceFile();
  const line = source.getLineAndCharacterOfPosition(node.getEnd()).line;
  const nextLineStart = source.getLineStarts()[line + 1];
  return { start: node.getStart(), end: nextLineStart ?? node.getEnd(), text: '' };
}

/**
 * Names `uql-orm` no longer exports and that the codemod does remove: only `Relation`, and only once
 * every usage was unwrapped. A removed *decorator* keeps its import on purpose (see
 * {@link REMOVED_DECORATORS}).
 */
function deadImportNames(source: ts.SourceFile, ctx: Context): ReadonlySet<string> {
  const { seen, unwrapped } = ctx.relationAlias;
  if (seen > unwrapped) {
    ctx.unresolved.push(
      `${source.fileName}: ${seen - unwrapped} 'Relation<T>' reference(s) are somewhere this codemod does ` +
        'not rewrite; unwrap them and drop the import by hand',
    );
  }
  return new Set(seen > 0 && seen === unwrapped ? ['Relation'] : []);
}

/**
 * Removes `import 'reflect-metadata'`, since the polyfill only ever fed `design:type`, and each `dead` name
 * from the imports {@link renameExports} left as written, having left the dead names out of the rest.
 */
function dropDeadImports(
  source: ts.SourceFile,
  dead: ReadonlySet<string>,
  rewritten: ReadonlySet<ts.ImportDeclaration>,
  ctx: Context,
): void {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text === 'reflect-metadata' && !statement.importClause) {
      ctx.edits.push(removeStatement(statement));
      continue;
    }

    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named) || rewritten.has(statement)) {
      continue;
    }
    const dropped = named.elements.filter((element) => dead.has(element.name.text));
    if (dropped.length === named.elements.length && !statement.importClause?.name) {
      ctx.edits.push(removeStatement(statement));
      continue;
    }
    for (const element of dropped) {
      ctx.edits.push(removeFromList(named.elements, element, source));
    }
  }
}

/** The names a key is read from without help, mirroring `NamedIdKey` in `uql-orm`. */
const CONVENTIONAL_ID_NAMES = new Set(['id', '_id', 'uuid']);

/** Whether the member is an `[idKey]?: ...` brand, matched by the name it is written under. */
function isIdKeyBrand(member: ts.ClassElement): boolean {
  return (
    ts.isPropertyDeclaration(member) &&
    ts.isComputedPropertyName(member.name) &&
    ts.isIdentifier(member.name.expression) &&
    member.name.expression.text === 'idKey'
  );
}

/**
 * Names the class's key with the `idKey` brand, where a conventional name does not already.
 *
 * Only the class's own `@Id` properties are read, which is also what makes an overriding key right:
 * a subclass that replaces an inherited `id` needs the brand precisely because the inherited name
 * would otherwise be taken for the key.
 *
 * One written makes `idKey` a value the file has to import, which is recorded for {@link addImports}.
 */
function brandIdKey(node: ts.ClassDeclaration | ts.ClassExpression, ctx: Context): void {
  const ids = node.members.filter(isIdProperty);
  if (!ids.length || node.members.some(isIdKeyBrand)) {
    return;
  }
  const names = ids.map((m) => propertyKey(m.name)).filter((name) => name !== undefined);
  if (names.length !== ids.length) {
    ctx.unresolved.push(`${ctx.describe(node)}: a key written as a computed name; add the 'idKey' brand by hand`);
    return;
  }
  if (names.length === 1 && CONVENTIONAL_ID_NAMES.has(names[0])) {
    return;
  }
  const indent = ' '.repeat(node.getSourceFile().getLineAndCharacterOfPosition(ids[0].getStart()).character);
  const brand = names.map(quoted).join(' | ');
  const start = node.members.pos;
  ctx.edits.push({ start, end: start, text: `\n${indent}[idKey]?: ${brand};` });
  ctx.imports.set('idKey', 'the brand(s)');
}

/**
 * Imports what the rewrites wrote (`idKey`, `raw`) into the file's own `uql-orm` import. Reported instead
 * where there is none: the package may be imported under a path this codemod does not recognise.
 */
function addImports(source: ts.SourceFile, rewritten: ReadonlySet<ts.ImportDeclaration>, ctx: Context): void {
  const imported = new Set(uqlImports(source).map(importedName));
  const missing = [...ctx.imports].filter(([name]) => !imported.has(name));
  if (!missing.length) {
    return;
  }
  const anchor = uqlImportDeclarations(source).find(({ declaration }) => !rewritten.has(declaration))?.elements[0];
  if (!anchor) {
    for (const [name, what] of missing) {
      ctx.unresolved.push(`${source.fileName}: import '${name}' from 'uql-orm' for ${what} written here`);
    }
    return;
  }
  ctx.edits.push(inserted(anchor, missing.map(([name]) => `${name}, `).join('')));
}

/** Everything the standard spec needs written onto one decorated property, and the options renamed since. */
function rewriteProperty(node: ts.PropertyDeclaration, ctx: Context): void {
  const owner: Owner = { param: paramFor(node.parent.name?.text), entity: node.parent };
  const decorators = decoratorsOf(node);
  for (const decorator of decorators) {
    const name = decoratorName(decorator);
    if (!name) {
      continue;
    }
    const options = decoratorOptions(decorator);
    if (FIELD_DECORATORS.has(name)) {
      if (name === 'Field') {
        admitNull(options, node, ctx);
      }
      addFieldType(decorator, node, ctx);
      // Options it cannot read may still hold `virtual`, so they are reported where they mention it.
      if (options.kind === 'opaque' && /\bvirtual\b/.test(decorator.getText())) {
        ctx.unresolved.push(`${ctx.describe(node)}: ${options.reason}`);
      }
      renameSqlOption(options, 'virtual', 'computed', node, owner, ctx);
    }
    if (RELATION_DECORATORS.has(name)) {
      addRelationEntity(decorator, node, ctx);
    }
    if (RELATION_DECORATORS.has(name) && options.kind === 'literal') {
      const target = relationTargetFor(ctx.checker.getTypeAtLocation(node), ctx.checker);
      rewriteRelationOptions(options.node, owner.param, ctx, paramFor(target));
      if (TO_ONE_DECORATORS.has(name)) {
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
 * A column holds `null` unless `nullable: false` says otherwise, and a read hydrates one, so the property
 * says so too. A key is NOT NULL on every engine, and a relation aggregate is typed by the aggregate,
 * which declares its own `null` or none, so neither is touched.
 */
function admitNull(options: Options, node: ts.PropertyDeclaration, ctx: Context): void {
  // Options it cannot read may state `nullable` themselves, and appending to the property would then
  // contradict the column. `addFieldType` already reports the same options, so this adds no second note.
  if (options.kind === 'opaque') {
    return;
  }
  if (
    declaresNotNull(options) ||
    findProperty(options, 'isId') ||
    (findProperty(options, 'computed') && !findProperty(options, 'type'))
  ) {
    return;
  }
  if (!node.type) {
    ctx.notes.push(
      `${ctx.describe(node)}: declare '${propertyKey(node.name)}' as a type that admits 'null', which the column holds`,
    );
    return;
  }
  if (admitsNull(node.type)) {
    return;
  }
  ctx.edits.push(appended(node.type, ' | null'));
}

/**
 * The same null rule where `defineEntity` names the field: the property is on the class the call takes,
 * so the declaration is found there rather than under a decorator.
 */
function admitNullOnDefined(field: NamedProperty, owner: Owner, ctx: Context): void {
  if (!ts.isPropertyAssignment(field)) {
    return;
  }
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
      ctx.unresolved.push(`${ctx.describe(decorator)}: '@${name}()' was removed; ${advice}`);
    }
  }
}

/** Names an export that no longer exists, where it is imported from the package or one of its entries. */
function reportRemovedExports(source: ts.SourceFile, ctx: Context): void {
  for (const element of uqlImports(source, true)) {
    const name = importedName(element);
    const advice = REMOVED_EXPORTS.get(name);
    if (advice) {
      ctx.unresolved.push(`${ctx.describe(element)}: '${name}' was removed; ${advice}`);
    }
  }
}

/**
 * Rewrites each import naming a {@link RENAMED_EXPORTS} export, renaming every use of it: a name moving
 * entries gets an import from its new one, and a name the file already imports is dropped, as is a `dead`
 * one. Returns the rewritten imports, which nothing else may edit.
 */
function renameExports(
  source: ts.SourceFile,
  dead: ReadonlySet<string>,
  ctx: Context,
): ReadonlySet<ts.ImportDeclaration> {
  const imports = uqlImportDeclarations(source, true);
  const kept = imports.flatMap(({ elements }) => elements).filter((element) => !renamedTo(element));
  const bound = new Set(kept.map((element) => element.name.text));
  const rewritten = new Set<ts.ImportDeclaration>();
  for (const { declaration, entry, elements } of imports) {
    if (!elements.some(renamedTo)) {
      continue;
    }
    const byEntry = new Map<string, string[]>([[entry, []]]);
    for (const element of elements.filter(({ name }) => !dead.has(name.text))) {
      const rename = renamedTo(element);
      const local = element.propertyName || !rename ? element.name.text : rename.to;
      if (rename && !element.propertyName) {
        ctx.edits.push(...usesOf(source, element.name, ctx.checker).map((use) => replaced(use, rename.to)));
      }
      if (rename && bound.has(local)) {
        continue;
      }
      bound.add(local);
      const target = rename?.from ?? entry;
      const text = rename
        ? `${element.isTypeOnly ? 'type ' : ''}${rename.to}${element.propertyName ? ` as ${local}` : ''}`
        : element.getText();
      byEntry.set(target, [...(byEntry.get(target) ?? []), text]);
    }
    const typeOnly = declaration.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    const keyword = typeOnly ? 'import type' : 'import';
    const quote = declaration.moduleSpecifier.getText()[0];
    const statements = [...byEntry]
      .filter(([, names]) => names.length)
      .map(([from, names]) => `${keyword} { ${names.join(', ')} } from ${quote}${from}${quote};`);
    ctx.edits.push(statements.length ? replaced(declaration, statements.join('\n')) : removeStatement(declaration));
    rewritten.add(declaration);
  }
  return rewritten;
}

function renamedTo(element: ts.ImportSpecifier) {
  return RENAMED_EXPORTS.get(importedName(element));
}

/** Every identifier in the file bound to the same symbol as `name`, besides `name` itself. */
function usesOf(source: ts.SourceFile, name: ts.Identifier, checker: ts.TypeChecker): ts.Identifier[] {
  const symbol = checker.getSymbolAtLocation(name);
  const uses: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      if (symbol && checker.getSymbolAtLocation(node) === symbol) {
        uses.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

type UqlImport = {
  readonly declaration: ts.ImportDeclaration;
  readonly entry: string;
  readonly elements: readonly ts.ImportSpecifier[];
};

/**
 * The file's named imports from `uql-orm`. `entries` adds the driver entries (`uql-orm/postgres`, ...),
 * for what is read by name only: `idKey` written into one would land on an entry that may not export it.
 */
function uqlImportDeclarations(source: ts.SourceFile, entries = false): readonly UqlImport[] {
  return source.statements.flatMap((declaration) => {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) {
      return [];
    }
    const entry = declaration.moduleSpecifier.text;
    if (entry !== 'uql-orm' && !(entries && entry.startsWith('uql-orm/'))) {
      return [];
    }
    const bindings = declaration.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? [{ declaration, entry, elements: bindings.elements }] : [];
  });
}

function uqlImports(source: ts.SourceFile, entries = false): readonly ts.ImportSpecifier[] {
  return uqlImportDeclarations(source, entries).flatMap(({ elements }) => elements);
}

/** The name an import specifier brings in, which is the original one where it was renamed. */
function importedName(element: ts.ImportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

/**
 * Rewrites `raw('sql')` into the tagged template, and a second alias argument into `.as()`, the callback
 * form's included. A computed string is left alone: a template cannot be built from a value not known here.
 */
function rewriteRawCall(node: ts.Node, ctx: Context, source: ts.SourceFile): void {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'raw') {
    return;
  }
  const [expression, alias] = node.arguments;
  if (!expression || node.arguments.length > 2) {
    return;
  }
  const suffix = alias ? `.as(${alias.getText(source)})` : '';
  if (ts.isStringLiteral(expression)) {
    ctx.edits.push(replaced(node, `${rawTag(expression.text)}${suffix}`));
  } else if (alias) {
    ctx.edits.push({ start: expression.getEnd(), end: node.getEnd(), text: `)${suffix}` });
  }
}

/**
 * Rewrites each `col('x')` into the ref it names - `product.x` in a `computed` callback, `refs(Item).x` in a
 * statement - where the entity its SQL renders against, and a member named `x`, can be told from here. Every
 * other use is reported. Returns `col` as a dead import once no use is left.
 */
function rewriteColumnRefs(source: ts.SourceFile, ctx: Context): readonly string[] {
  const element = uqlImports(source).find((use) => importedName(use) === 'col');
  if (!element) {
    return [];
  }
  const computed = new Map<ts.TaggedTemplateExpression, { owner: Owner; calls: ts.CallExpression[] }>();
  const unread: ts.Node[] = [];
  for (const use of usesOf(source, element.name, ctx.checker)) {
    const call = ts.isCallExpression(use.parent) && use.parent.expression === use ? use.parent : undefined;
    const sql = call && ts.findAncestor(call, isRaw);
    const option = sql?.parent;
    const owner =
      option && ts.isPropertyAssignment(option) && isComputedOption(option) ? computedOwner(option) : undefined;
    const edit = call && !owner ? statementRefEdit(call, ctx) : undefined;
    if (call && sql && ts.isTaggedTemplateExpression(sql) && owner) {
      computed.set(sql, { owner, calls: [...(computed.get(sql)?.calls ?? []), call] });
    } else if (edit) {
      ctx.edits.push(edit);
      ctx.imports.set('refs', 'the refs(...)');
    } else {
      unread.push(use);
    }
  }
  for (const [sql, { owner, calls }] of computed) {
    const edits = computedRefEdits(sql, calls, owner, ctx);
    if (edits) {
      ctx.edits.push(...edits);
    } else {
      unread.push(...calls);
    }
  }
  for (const node of unread.sort((a, b) => a.getStart() - b.getStart())) {
    ctx.unresolved.push(
      `${ctx.describe(node)}: 'col' was removed; read the column off refs(Entity), which the codemod could not tell here`,
    );
  }
  return unread.length ? [] : ['col'];
}

function isComputedOption(option: ts.PropertyAssignment): boolean {
  const key = propertyKey(option.name);
  return key === 'computed' || key === 'virtual';
}

/** The entity a field's `computed` SQL is declared on: the decorated property's class, or `defineEntity`'s first argument. */
function computedOwner(option: ts.PropertyAssignment): Owner | undefined {
  const holder = ts.findAncestor(
    option,
    (node): node is ts.PropertyDeclaration | ts.CallExpression =>
      ts.isPropertyDeclaration(node) ||
      (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineEntity'),
  );
  if (holder && ts.isPropertyDeclaration(holder)) {
    return { param: paramFor(holder.parent.name?.text), entity: holder.parent };
  }
  const [entity] = holder?.arguments ?? [];
  return entity && { param: paramFor(ts.isIdentifier(entity) ? entity.text : undefined), entity };
}

/** `(product) => ` before a `computed` raw, and `product.x` for each `col('x')` in it, where every one names a member. */
function computedRefEdits(
  sql: ts.TaggedTemplateExpression,
  calls: readonly ts.CallExpression[],
  owner: Owner,
  ctx: Context,
): Edits {
  const members = memberNames(owner.entity, ctx.checker);
  const names = calls.map((call) => columnMember(call, members));
  if (mentions(sql, owner.param) || !names.every((name): name is string => name !== undefined)) {
    return undefined;
  }
  return [
    inserted(sql, `(${owner.param}) => `),
    ...calls.map((call, at) => replaced(call, memberAccess(owner.param, names[at]))),
  ];
}

/** `refs(Item).x` for a `col('x')` in a statement, where the entity its SQL renders against can be told. */
function statementRefEdit(call: ts.CallExpression, ctx: Context): Edit | undefined {
  const entity = statementEntity(call, ctx.checker);
  const name = entity && columnMember(call, propertyNames(entity.type));
  return entity && name !== undefined ? replaced(call, memberAccess(`refs(${entity.name})`, name)) : undefined;
}

/** The member a `col('x')` names, where its one argument is a literal naming one of `members`. */
function columnMember(call: ts.CallExpression, members: ReadonlySet<string>): string | undefined {
  const [name] = call.arguments;
  return call.arguments.length === 1 && ts.isStringLiteralLike(name) && members.has(name.text) ? name.text : undefined;
}

/** Whether `node` reads a binding named `name`, which a callback parameter of that name would shadow. */
function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node)) {
    return node.text === name && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node);
  }
  return ts.forEachChild(node, (child) => mentions(child, name) || undefined) ?? false;
}

type NamedEntity = { readonly name: string; readonly type: ts.Type };

/**
 * The entity a statement's SQL renders against at `node`: the one its query names, or a relation a `$populate`
 * reads there. Nothing where a function or a relation filter in between opens a scope of its own.
 */
function statementEntity(node: ts.Node, checker: ts.TypeChecker): NamedEntity | undefined {
  const path: string[] = [];
  for (let at: ts.Node = node; at.parent; at = at.parent) {
    const { parent } = at;
    if (ts.isFunctionLike(parent)) {
      return undefined;
    }
    if (ts.isPropertyAssignment(parent)) {
      path.unshift(propertyKey(parent.name) ?? '');
    }
    const queried = ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === at);
    const entity = queried ? queriedEntity(parent, checker) : undefined;
    if (entity) {
      return entityAlong(entity, path, node, checker);
    }
  }
  return undefined;
}

/** The entity a call queries: its first argument's class, or the `$entity` its query names. */
function queriedEntity(call: ts.CallExpression, checker: ts.TypeChecker): NamedEntity | undefined {
  const [first] = call.arguments;
  const entity = first && ts.isObjectLiteralExpression(first) ? propertyValue(first, '$entity') : first;
  const instance = entity && checker.getTypeAtLocation(entity).getConstructSignatures()[0]?.getReturnType();
  return entity && ts.isIdentifier(entity) && instance ? { name: entity.text, type: instance } : undefined;
}

/** `entity` followed along `path`: into each relation a `$populate` names, and nowhere a relation filter opens. */
function entityAlong(
  entity: NamedEntity,
  path: readonly string[],
  node: ts.Node,
  checker: ts.TypeChecker,
): NamedEntity | undefined {
  let current = entity;
  for (const [at, key] of path.entries()) {
    const property = current.type.getProperty(key);
    const related = property && relatedClass(property, node, checker);
    if (!related) {
      continue;
    }
    const inScope = checker.getSymbolsInScope(node, ts.SymbolFlags.Class).some(({ name }) => name === related.name);
    if (path[at - 1] !== '$populate' || !inScope) {
      return undefined;
    }
    current = { name: related.name, type: checker.getDeclaredTypeOfSymbol(related) };
  }
  return current;
}

/** The class a relation property points at, one or many, or nothing where the property holds no class. */
function relatedClass(property: ts.Symbol, node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, node));
  const symbol = (checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type).getSymbol();
  return symbol && symbol.flags & ts.SymbolFlags.Class ? symbol : undefined;
}

/** Rewrites one source file for the standard decorator spec. */
export function transformFile(source: ts.SourceFile, checker: ts.TypeChecker): FileResult {
  const ctx: Context = {
    checker,
    edits: [],
    unresolved: [],
    notes: [],
    imports: new Map(),
    relationAlias: { seen: 0, unwrapped: 0 },
    describe: (node) => `${source.fileName}:${lineOf(node) + 1}`,
  };
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line;

  const rewritesRaw = uqlImports(source).some((element) => importedName(element) === 'raw');
  // The builder's methods are known by name alone, so they are read only in a file that imports uql-orm.
  const importsUql = uqlImportDeclarations(source, true).length > 0;

  const visit = (node: ts.Node): void => {
    reportRemovedDecorators(node, ctx);
    countRelationAlias(node, ctx);
    if (rewritesRaw) {
      rewriteRawCall(node, ctx, source);
    }
    if (ts.isPropertyDeclaration(node)) {
      rewriteProperty(node, ctx);
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      brandIdKey(node, ctx);
      rewriteClassDecorators(node, ctx);
    }
    if (ts.isCallExpression(node)) {
      rewriteDefineCall(node, ctx);
      if (importsUql) {
        rewriteBuilderCall(node, ctx);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      rewriteStatementKeys(node, ctx);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const dead = new Set([...deadImportNames(source, ctx), ...rewriteColumnRefs(source, ctx)]);
  const rewritten = renameExports(source, dead, ctx);
  reportRemovedExports(source, ctx);
  dropDeadImports(source, dead, rewritten, ctx);
  addImports(source, rewritten, ctx);

  return {
    fileName: source.fileName,
    text: applyEdits(source.getFullText(), ctx.edits),
    changed: ctx.edits.length > 0,
    unresolved: ctx.unresolved,
    notes: ctx.notes,
  };
}
