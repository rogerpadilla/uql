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

function hasProperty(options: DecoratorOptions, name: string): boolean {
  return (
    options.kind === 'literal' &&
    options.node.properties.some((prop) => prop.name && ts.isIdentifier(prop.name) && prop.name.text === name)
  );
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
  if (spec.satisfiedBy.some((name) => hasProperty(options, name))) {
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
    ctx.edits.push({ start: declared.getStart(), end: declared.getEnd(), text: declared.typeArguments[0]!.getText() });
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

/** Everything the standard spec needs written onto one decorated property. */
function rewriteProperty(node: ts.PropertyDeclaration, ctx: Context): void {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
  for (const decorator of decorators) {
    const name = decoratorName(decorator);
    if (!name) {
      continue;
    }
    if (FIELD_DECORATORS.has(name)) {
      addFieldType(decorator, node, ctx);
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
  if (!ts.canHaveDecorators(node)) {
    return;
  }
  for (const decorator of ts.getDecorators(node) ?? []) {
    const name = decoratorName(decorator);
    const advice = name && REMOVED_DECORATORS.get(name);
    if (advice) {
      ctx.unresolved.push(`${ctx.describe(decorator)}: '@${name}()' was removed; ${advice}`);
    }
  }
}

/** Names an export that no longer exists, where it is imported from the package. */
function reportRemovedExports(node: ts.Node, ctx: Context): void {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
    return;
  }
  if (node.moduleSpecifier.text !== 'uql-orm') {
    return;
  }
  const bindings = node.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) {
    return;
  }
  for (const element of bindings.elements) {
    const name = (element.propertyName ?? element.name).text;
    const advice = REMOVED_EXPORTS.get(name);
    if (advice) {
      ctx.unresolved.push(`${ctx.describe(element)}: '${name}' was removed; ${advice}`);
    }
  }
}

/** Whether this file's `raw` is the ORM's, so another library's function of that name is left alone. */
function importsRaw(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    if (statement.moduleSpecifier.text !== 'uql-orm') {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return (
      !!bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => (element.propertyName ?? element.name).text === 'raw')
    );
  });
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

  const rewritesRaw = importsRaw(source);

  const visit = (node: ts.Node): void => {
    reportRemovedDecorators(node, ctx);
    reportRemovedExports(node, ctx);
    countRelationAlias(node, ctx);
    if (rewritesRaw) {
      rewriteRawCall(node, ctx, source);
    }
    if (ts.isPropertyDeclaration(node)) {
      rewriteProperty(node, ctx);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  dropDeadImports(source, ctx);

  return {
    fileName: source.fileName,
    text: applyEdits(source.getFullText(), ctx.edits),
    changed: ctx.edits.length > 0,
    unresolved: ctx.unresolved,
    notes: ctx.notes,
  };
}
