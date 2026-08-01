import ts from 'typescript';
import { applyEdits, type Edit, removeFromList } from './edits.js';
import { fieldTypeFor, isBrandedString, relationTargetFor } from './fieldType.js';

const FIELD_DECORATORS = new Set(['Field', 'Id']);
const RELATION_DECORATORS = new Set(['OneToOne', 'ManyToOne', 'OneToMany', 'ManyToMany']);

/**
 * Decorators that no longer exist, and that the codemod does not remove for you.
 *
 * A standard-spec decorator cannot preserve a generic method's signature, which is why these went. What
 * to do instead is a judgement call - inline the logging, drop the serialisation - so the usage is
 * reported and left in place. Removing only the import would swap a clear error for a puzzling one.
 */
const REMOVED_DECORATORS = new Set(['Log', 'Serialized']);

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
  /** Named imports from `uql-orm` the rewrites still need. */
  readonly imports: Set<string>;
  /** `Relation<T>` references seen, and how many were unwrapped, which decides whether its import goes. */
  readonly relationAlias: { seen: number; unwrapped: number };
  readonly describe: (node: ts.Node) => string;
  readonly lineOf: (node: ts.Node) => number;
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

/**
 * Rewrites an `@InjectQuerier()` parameter into a `currentQuerier()` call.
 *
 * The standard spec has no parameter decorators, so the querier travels through async-local storage and
 * is read inside the body. Only the plain shape is rewritten - a named parameter in a method with a body.
 * A default value or a destructured parameter is reported: the author was doing something the codemod
 * would have to guess at.
 */
function rewriteInjectQuerier(method: ts.MethodDeclaration, ctx: Context): void {
  for (const parameter of method.parameters) {
    if (!ts.getDecorators(parameter)?.some((d) => decoratorName(d) === 'InjectQuerier')) {
      continue;
    }
    if (!method.body || !ts.isIdentifier(parameter.name) || parameter.initializer) {
      ctx.unresolved.push(`${ctx.describe(parameter)}: cannot rewrite this '@InjectQuerier()' parameter`);
      continue;
    }

    ctx.edits.push(removeFromList(method.parameters, parameter, method.getSourceFile()));

    // The querier is read at the top of the body, keeping the name the parameter had.
    const body = method.body;
    const first = body.statements[0];
    const indent = first ? ' '.repeat(first.getStart() - body.getSourceFile().getLineStarts()[ctx.lineOf(first)]) : '';
    ctx.edits.push({
      start: body.getStart() + 1,
      end: body.getStart() + 1,
      text: `\n${indent}const ${parameter.name.text} = currentQuerier();`,
    });
    ctx.imports.add('currentQuerier');
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
 * Brings the file's imports in line with what the rewrites left behind, in one pass:
 *
 * - `import 'reflect-metadata'` goes, since the polyfill only ever fed `design:type`.
 * - `InjectQuerier` goes with it, and its import would otherwise not compile: the standard spec has no
 *   parameter decorators, so `uql-orm` no longer exports one.
 * - whatever a rewrite needs (`currentQuerier`) is added, extending an existing `uql-orm` import rather
 *   than adding a second one.
 *
 * One function because all three edit the same statements, and doing them separately meant an import
 * could be dropped and re-added, or a name added to a statement another edit had already removed.
 */
function reconcileImports(source: ts.SourceFile, ctx: Context): void {
  // Dropping runs first and hands over the `uql-orm` import it left standing: adding a name to a
  // statement the other pass had already removed is the bug that made these one step to begin with.
  addNeededImports(source, ctx, dropDeadImports(source, ctx));
}

/** Names `uql-orm` no longer exports. `Relation` joins them only when every usage was rewritten. */
function deadImportNames(source: ts.SourceFile, ctx: Context): ReadonlySet<string> {
  const { seen, unwrapped } = ctx.relationAlias;
  if (seen > unwrapped) {
    ctx.unresolved.push(
      `${source.fileName}: ${seen - unwrapped} 'Relation<T>' reference(s) are somewhere this codemod does ` +
        'not rewrite; unwrap them and drop the import by hand',
    );
  }
  return new Set(seen > 0 && seen === unwrapped ? ['InjectQuerier', 'Relation'] : ['InjectQuerier']);
}

/**
 * Removes `import 'reflect-metadata'` and any name that no longer exists, and returns the `uql-orm`
 * named imports still standing - `undefined` when there are none to extend.
 */
function dropDeadImports(source: ts.SourceFile, ctx: Context): ts.NamedImports | undefined {
  const dead = deadImportNames(source, ctx);
  let host: ts.NamedImports | undefined;

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const module = statement.moduleSpecifier.text;
    if (module === 'reflect-metadata' && !statement.importClause) {
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
    if (module === 'uql-orm') {
      host = named;
    }
  }

  return host;
}

/** Adds what the rewrites need, extending `host` when there is one rather than adding a second import. */
function addNeededImports(source: ts.SourceFile, ctx: Context, host: ts.NamedImports | undefined): void {
  const missing = [...ctx.imports].filter((name) => !host?.elements.some((element) => element.name.text === name));
  if (!missing.length) {
    return;
  }
  if (host) {
    const last = host.elements[host.elements.length - 1];
    ctx.edits.push({ start: last.getEnd(), end: last.getEnd(), text: `, ${missing.join(', ')}` });
    return;
  }
  const position = source.statements[0]?.getStart() ?? 0;
  ctx.edits.push({ start: position, end: position, text: `import { ${missing.join(', ')} } from 'uql-orm';\n` });
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
    if (name && REMOVED_DECORATORS.has(name)) {
      ctx.unresolved.push(`${ctx.describe(decorator)}: '@${name}()' was removed; delete it and its import`);
    }
  }
}

/** Rewrites one source file for the standard decorator spec. */
export function transformFile(source: ts.SourceFile, checker: ts.TypeChecker): FileResult {
  const ctx: Context = {
    checker,
    edits: [],
    unresolved: [],
    notes: [],
    imports: new Set(),
    relationAlias: { seen: 0, unwrapped: 0 },
    describe: (node) => `${source.fileName}:${ctx.lineOf(node) + 1}`,
    lineOf: (node) => source.getLineAndCharacterOfPosition(node.getStart()).line,
  };

  const visit = (node: ts.Node): void => {
    reportRemovedDecorators(node, ctx);
    countRelationAlias(node, ctx);
    if (ts.isPropertyDeclaration(node)) {
      rewriteProperty(node, ctx);
    } else if (ts.isMethodDeclaration(node)) {
      rewriteInjectQuerier(node, ctx);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  reconcileImports(source, ctx);

  return {
    fileName: source.fileName,
    text: applyEdits(source.getFullText(), ctx.edits),
    changed: ctx.edits.length > 0,
    unresolved: ctx.unresolved,
    notes: ctx.notes,
  };
}
