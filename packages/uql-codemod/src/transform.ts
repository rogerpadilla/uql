import ts from 'typescript';
import { applyEdits, type Edit, removeFromList } from './edits.js';
import { fieldTypeFor, isBrandedString, relationTargetFor } from './fieldType.js';

const FIELD_DECORATORS = new Set(['Field', 'Id']);
const RELATION_DECORATORS = new Set(['OneToOne', 'ManyToOne', 'OneToMany', 'ManyToMany']);

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
 * same reason as the decorators: which pool belongs at a given call site is a judgement call.
 */
const REMOVED_EXPORTS = new Map([
  ['setQuerierPool', 'pass the pool where it is used: `createFetchHandler({ pool })`, `querierMiddleware({ pool })`'],
  ['getQuerierPool', 'take the pool from the module that builds it, or from Nest DI'],
  ['getQuerier', 'use `pool.withQuerier(...)` / `pool.transaction(...)`, which release the connection'],
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
 * What the codemod can see of a decorator's options.
 *
 * `opaque` is the case that matters: `@Field(shared)` passes an options object the codemod cannot read,
 * and writing into it would mean replacing the argument, silently dropping whatever the author put
 * there. A spread is opaque for the same reason - `{ ...base }` may already carry the option, and
 * inserting before it lets the spread win anyway.
 */
type DecoratorOptions =
  | { readonly kind: 'empty'; readonly call: ts.CallExpression }
  | { readonly kind: 'literal'; readonly node: ts.ObjectLiteralExpression }
  | { readonly kind: 'opaque'; readonly reason: string };

/** The forms an option can be written into, which is what {@link insertOption} needs and nothing more. */
type WritableOptions = Extract<DecoratorOptions, { kind: 'empty' | 'literal' }>;

function decoratorOptions(node: ts.Decorator): DecoratorOptions {
  if (!ts.isCallExpression(node.expression)) {
    // `@Field` rather than `@Field()`: there is no argument list to write into, and adding one would mean
    // guessing that this is the decorator factory the codemod thinks it is.
    return { kind: 'opaque', reason: 'it is used without being called' };
  }
  const [first] = node.expression.arguments;
  if (!first) {
    return { kind: 'empty', call: node.expression };
  }
  if (!ts.isObjectLiteralExpression(first)) {
    return { kind: 'opaque', reason: `its options are passed as '${first.getText()}'` };
  }
  return first.properties.some(ts.isSpreadAssignment)
    ? { kind: 'opaque', reason: 'its options object spreads another' }
    : { kind: 'literal', node: first };
}

/** A named property of the options object, however its key is written. */
type NamedProperty = ts.PropertyAssignment | ts.ShorthandPropertyAssignment;

/**
 * The property `name` in the decorator's options, whether its key is plain, quoted or a shorthand.
 *
 * All three forms, because both callers care about the option being *there*: one to leave an option
 * alone that is already stated, the other to rename it. Matching only the plain key inserted a second
 * `type` beside a quoted one, and left a shorthand `virtual` behind while reporting nothing.
 */
function findProperty(options: DecoratorOptions, name: string): NamedProperty | undefined {
  if (options.kind !== 'literal') {
    return undefined;
  }
  return options.node.properties.find(
    (prop): prop is NamedProperty =>
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && propertyKey(prop.name) === name,
  );
}

/** A key's name where it is spelled out, which is every form but a computed one (`{ [k]: v }`). */
function propertyKey(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * Renames the `virtual` option to `computed`, the one it was renamed to.
 *
 * Only the key is replaced, so the expression, its formatting and any comment inside the options
 * object survive untouched. A shorthand has no value to keep, so it becomes `computed: virtual` -
 * renaming the key alone would rebind it to a local that does not exist.
 */
function renameVirtualOption(decorator: ts.Decorator, node: ts.Node, ctx: Context): void {
  const options = decoratorOptions(decorator);
  const virtual = findProperty(options, 'virtual');
  if (!virtual) {
    if (options.kind === 'opaque' && /\bvirtual\b/.test(decorator.getText())) {
      ctx.unresolved.push(`${ctx.describe(node)}: ${options.reason}`);
    }
    return;
  }
  if (findProperty(options, 'computed')) {
    ctx.unresolved.push(`${ctx.describe(node)}: gives both 'virtual' and 'computed'; keep 'computed'.`);
    return;
  }
  const text = ts.isShorthandPropertyAssignment(virtual) ? 'computed: virtual' : 'computed';
  ctx.edits.push({ start: virtual.name.getStart(), end: virtual.name.getEnd(), text });
}

/** Inserts `option` into the decorator's options object, creating one when the call has no arguments. */
function insertOption(options: WritableOptions, option: string): Edit {
  if (options.kind === 'empty') {
    // `@Field()` -> `@Field({ ... })`: the argument list is empty, so this only ever inserts.
    const { arguments: args } = options.call;
    return { start: args.pos, end: args.end, text: `{ ${option} }` };
  }
  const first = options.node.properties[0];
  return first
    ? { start: first.getStart(), end: first.getStart(), text: `${option}, ` }
    : { start: options.node.getStart(), end: options.node.getEnd(), text: `{ ${option} }` };
}

type Context = {
  readonly checker: ts.TypeChecker;
  readonly edits: Edit[];
  readonly unresolved: string[];
  readonly notes: string[];
  /** `Relation<T>` references seen, and how many were unwrapped, which decides whether its import goes. */
  readonly relationAlias: { seen: number; unwrapped: number };
  readonly describe: (node: ts.Node) => string;
};

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
    while (/\s/.test(text[end] ?? '')) {
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
    ctx.edits.push({ start: declared.getStart(), end: declared.getEnd(), text: declared.typeArguments[0].getText() });
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
 * Removes `import 'reflect-metadata'`, since the polyfill only ever fed `design:type`, and any name
 * `uql-orm` no longer exports.
 */
function dropDeadImports(source: ts.SourceFile, ctx: Context): void {
  const dead = deadImportNames(source, ctx);

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text === 'reflect-metadata' && !statement.importClause) {
      ctx.edits.push(removeStatement(statement));
      continue;
    }

    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) {
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
 * Reports whether one was written, since `idKey` is then a value the file has to import.
 */
function brandIdKey(node: ts.ClassDeclaration | ts.ClassExpression, ctx: Context): boolean {
  const ids = node.members.filter(
    (m): m is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(m) && decoratorsOf(m).some((d) => decoratorName(d) === 'Id'),
  );
  if (!ids.length || node.members.some(isIdKeyBrand)) {
    return false;
  }
  const names = ids.map((m) => propertyKey(m.name)).filter((name) => name !== undefined);
  if (names.length !== ids.length) {
    ctx.unresolved.push(`${ctx.describe(node)}: a key written as a computed name; add the 'idKey' brand by hand`);
    return false;
  }
  if (names.length === 1 && CONVENTIONAL_ID_NAMES.has(names[0])) {
    return false;
  }
  const indent = ' '.repeat(node.getSourceFile().getLineAndCharacterOfPosition(ids[0].getStart()).character);
  const brand = names.map((name) => `'${name}'`).join(' | ');
  const start = node.members.pos;
  ctx.edits.push({ start, end: start, text: `\n${indent}[idKey]?: ${brand};` });
  return true;
}

/**
 * Imports `idKey` where a brand was written, into the file's own `uql-orm` import. Reported instead
 * where there is none: the package may be imported under a path this codemod does not recognise.
 */
function addIdKeyImport(source: ts.SourceFile, ctx: Context): void {
  const imported = uqlImports(source);
  if (imported.some((element) => importedName(element) === 'idKey')) {
    return;
  }
  const [anchor] = imported;
  if (!anchor) {
    ctx.unresolved.push(`${source.fileName}: import 'idKey' from 'uql-orm' for the brand(s) written here`);
    return;
  }
  ctx.edits.push({ start: anchor.getStart(), end: anchor.getStart(), text: 'idKey, ' });
}

/** Everything the standard spec needs written onto one decorated property. */
function rewriteProperty(node: ts.PropertyDeclaration, ctx: Context): void {
  const decorators = decoratorsOf(node);
  for (const decorator of decorators) {
    const name = decoratorName(decorator);
    if (!name) {
      continue;
    }
    if (FIELD_DECORATORS.has(name)) {
      addFieldType(decorator, node, ctx);
      renameVirtualOption(decorator, node, ctx);
    }
    if (RELATION_DECORATORS.has(name)) {
      addRelationEntity(decorator, node, ctx);
    }
  }
  if (decorators.length) {
    dropDeclare(node, ctx);
  }
  unwrapRelationAlias(node, ctx);
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

/** Names an export that no longer exists, where it is imported from the package. */
function reportRemovedExports(source: ts.SourceFile, ctx: Context): void {
  for (const element of uqlImports(source)) {
    const name = importedName(element);
    const advice = REMOVED_EXPORTS.get(name);
    if (advice) {
      ctx.unresolved.push(`${ctx.describe(element)}: '${name}' was removed; ${advice}`);
    }
  }
}

/** What the file imports from `uql-orm` by name, which is every import this codemod reads or writes. */
function uqlImports(source: ts.SourceFile): readonly ts.ImportSpecifier[] {
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    if (statement.moduleSpecifier.text !== 'uql-orm') {
      return [];
    }
    const bindings = statement.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? [...bindings.elements] : [];
  });
}

/** The name an import specifier brings in, which is the original one where it was renamed. */
function importedName(element: ts.ImportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

/**
 * Rewrites `raw('sql')` into the tagged template, and a second alias argument into `.as()`. Only a
 * string-literal first argument qualifies: the callback form is unchanged, and a computed string is
 * left alone because a template cannot be built from a value that is not known here.
 */
function rewriteRawCall(node: ts.Node, ctx: Context, source: ts.SourceFile): void {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'raw') {
    return;
  }
  const [expression, alias] = node.arguments;
  if (!expression || !ts.isStringLiteral(expression) || node.arguments.length > 2) {
    return;
  }
  const suffix = alias ? `.as(${alias.getText(source)})` : '';
  ctx.edits.push({
    start: node.getStart(source),
    end: node.getEnd(),
    text: `raw\`${escapeForTemplate(expression.text)}\`${suffix}`,
  });
}

/** A backtick or a `${` inside the old string literal would end or interpolate the template. */
function escapeForTemplate(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Rewrites one source file for the standard decorator spec. */
export function transformFile(source: ts.SourceFile, checker: ts.TypeChecker): FileResult {
  const ctx: Context = {
    checker,
    edits: [],
    unresolved: [],
    notes: [],
    relationAlias: { seen: 0, unwrapped: 0 },
    describe: (node) => `${source.fileName}:${lineOf(node) + 1}`,
  };
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line;

  const rewritesRaw = uqlImports(source).some((element) => importedName(element) === 'raw');
  let branded = false;

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
      branded = brandIdKey(node, ctx) || branded;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  reportRemovedExports(source, ctx);
  dropDeadImports(source, ctx);
  if (branded) {
    addIdKeyImport(source, ctx);
  }

  return {
    fileName: source.fileName,
    text: applyEdits(source.getFullText(), ctx.edits),
    changed: ctx.edits.length > 0,
    unresolved: ctx.unresolved,
    notes: ctx.notes,
  };
}
