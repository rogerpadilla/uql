import ts from 'typescript';

/** The text of `node` where it is an identifier. */
export function identifierText(node: ts.Node | undefined): string | undefined {
  return node && ts.isIdentifier(node) ? node.text : undefined;
}

/** A key's name where it is spelled out, which is every form but a computed one (`{ [k]: v }`). */
export function propertyKey(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** A property of an object literal written with its own name: a plain or quoted key, or a shorthand. */
export type NamedProperty = ts.PropertyAssignment | ts.ShorthandPropertyAssignment;

export function isNamedProperty(prop: ts.ObjectLiteralElementLike): prop is NamedProperty {
  return ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop);
}

/** What a named property holds: a shorthand holds its name. */
export function namedValue(prop: NamedProperty): ts.Expression {
  return ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer;
}

/** What the `const` `name` reads holds, where one is declared before it in a scope it sits in. */
export function constValue(name: ts.Identifier): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = name.parent; scope; scope = scope.parent) {
    const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) ? scope.statements : [];
    for (const statement of statements) {
      if (statement.end > name.pos) {
        break;
      }
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      const { declarationList } = statement;
      const declared = declarationList.declarations.find((it) => identifierText(it.name) === name.text);
      if (declared && declarationList.flags & ts.NodeFlags.Const) {
        return declared.initializer;
      }
    }
  }
  return undefined;
}

/** The property `name` of an object literal, a shorthand included. */
export function namedProperty(node: ts.ObjectLiteralExpression, name: string): NamedProperty | undefined {
  return node.properties.find(
    (prop): prop is NamedProperty => isNamedProperty(prop) && propertyKey(prop.name) === name,
  );
}

/** The key a property is written under, a shorthand's included; nothing for a spread, a method or a computed key. */
export function keyOf(prop: ts.ObjectLiteralElementLike): string | undefined {
  return isNamedProperty(prop) ? propertyKey(prop.name) : undefined;
}

/**
 * What the codemod can see of an options object. `opaque` is one it cannot write into without dropping what
 * the author put there: `@Field(shared)`, or `{ ...base }`, whose spread may carry the option and would win.
 */
export type Options =
  | { readonly kind: 'empty'; readonly call: ts.CallExpression }
  | { readonly kind: 'literal'; readonly node: ts.ObjectLiteralExpression }
  | { readonly kind: 'opaque'; readonly reason: string };

/** The options `value` writes: a literal to read and write into, or why it is not one. */
export function optionsOf(value: ts.Expression): Exclude<Options, { kind: 'empty' }> {
  if (!ts.isObjectLiteralExpression(value)) {
    return { kind: 'opaque', reason: `its options are passed as '${value.getText()}'` };
  }
  return value.properties.some(ts.isSpreadAssignment)
    ? { kind: 'opaque', reason: 'its options object spreads another' }
    : { kind: 'literal', node: value };
}

/**
 * An object literal's named properties by key, each as its value (a shorthand's value is its name), or `undefined`
 * where `node` is no literal or one of its properties is spread, computed or a method.
 */
export function propertiesByKey(node: ts.Expression): Map<string, ts.Expression> | undefined {
  const literal = objectLiteral(node);
  if (!literal) {
    return undefined;
  }
  const props = new Map<string, ts.Expression>();
  for (const prop of literal.properties) {
    if (!isNamedProperty(prop)) {
      return undefined;
    }
    const key = propertyKey(prop.name);
    if (key === undefined) {
      return undefined;
    }
    props.set(key, namedValue(prop));
  }
  return props;
}

/** A method called on a chain: the call, the method's name, and the receiver it is called on. */
export type ChainMethod = { readonly call: ts.CallExpression; readonly name: string; readonly receiver: ts.Expression };

/** The root a method chain starts from, and its methods in source order: `f.string().nullable()` is `f` and two. */
export function chainOf(node: ts.Expression): {
  readonly root: ts.Expression;
  readonly methods: readonly ChainMethod[];
} {
  const methods: ChainMethod[] = [];
  let root = node;
  while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression)) {
    methods.unshift({ call: root, name: root.expression.name.text, receiver: root.expression.expression });
    root = root.expression.expression;
  }
  return { root, methods };
}

export function hasModifier(node: ts.Node, kind: ts.ModifierSyntaxKind): boolean {
  return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
}

/** `preferred`, or it numbered past every name `nodes` mention, so a parameter named so shadows nothing they read. */
export function freeName(preferred: string, nodes: readonly ts.Node[]): string {
  const taken = (name: string) => nodes.some((node) => mentions(node, name));
  let name = preferred;
  for (let n = 2; taken(name); n++) {
    name = `${preferred}${n}`;
  }
  return name;
}

/** Whether `node` is an identifier reading `name`, not a member named so. */
function readsName(node: ts.Node, name: string): node is ts.Identifier {
  return (
    ts.isIdentifier(node) &&
    node.text === name &&
    !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
  );
}

/** Each identifier in `node` naming `name`, in source order, nested functions included, but none a member named so. */
export function identifierUses(node: ts.Node, name: string): ts.Identifier[] {
  const uses: ts.Identifier[] = [];
  const visit = (child: ts.Node): void => {
    if (readsName(child, name)) {
      uses.push(child);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return uses;
}

/** Whether `node` reads a binding named `name`, which a callback parameter of that name would shadow: stops at the first. */
export function mentions(node: ts.Node, name: string): boolean {
  return readsName(node, name) || !!ts.forEachChild(node, (child) => mentions(child, name) || undefined);
}

/** The property `name` of an object literal that is written with a value. */
export function propertyAssignment(node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return node.properties.find(
    (prop): prop is ts.PropertyAssignment => ts.isPropertyAssignment(prop) && propertyKey(prop.name) === name,
  );
}

export function propertyValue(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  return propertyAssignment(node, name)?.initializer;
}

/** The property assignments of an object literal, or none where `node` is not one. */
export function objectProperties(node: ts.Expression | undefined): readonly ts.PropertyAssignment[] {
  return node && ts.isObjectLiteralExpression(node) ? node.properties.filter(ts.isPropertyAssignment) : [];
}

/** The entries of a column list, written as an array or returned by its callback. */
export function columnListEntries(list: ts.Expression | undefined): readonly ts.Expression[] {
  if (list && ts.isArrowFunction(list) && !ts.isBlock(list.body)) {
    return arrayElements(list.body);
  }
  return arrayElements(list);
}

/** The elements of an array literal, or none where `node` is not one. */
export function arrayElements(node: ts.Expression | undefined): readonly ts.Expression[] {
  return node && ts.isArrayLiteralExpression(node) ? node.elements : [];
}

/** `node` where it is an object literal. */
export function objectLiteral(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  return node && ts.isObjectLiteralExpression(node) ? node : undefined;
}

const indentUnits = new WeakMap<ts.SourceFile, string>();

/** Whether `node` starts a line of code whose indent a file's unit is read from: a member, a property, a statement. */
const startsCodeLine = (node: ts.Node): boolean =>
  ts.isClassElement(node) ||
  ts.isPropertyAssignment(node) ||
  ts.isShorthandPropertyAssignment(node) ||
  ts.isVariableStatement(node) ||
  ts.isExpressionStatement(node) ||
  ts.isClassDeclaration(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isImportDeclaration(node);

/** One level of indentation as the file writes it: the shallowest indent of its code, two spaces where it has none. */
export function indentUnit(source: ts.SourceFile): string {
  const known = indentUnits.get(source);
  if (known !== undefined) {
    return known;
  }
  const indents: string[] = [];
  const visit = (node: ts.Node): void => {
    const indent = startsCodeLine(node) ? indentOf(node) : '';
    if (indent) {
      indents.push(indent);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const unit = indents.reduce(
    (shallow, indent) => (indent.length < shallow.length ? indent : shallow),
    indents[0] ?? '  ',
  );
  indentUnits.set(source, unit);
  return unit;
}

/** A node's decorators, or none where it is a kind that cannot carry them. */
export function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/** `Field` for `@Field` and `@Field(...)`. */
export function decoratorName(node: ts.Decorator): string | undefined {
  const { expression } = node;
  return identifierText(ts.isCallExpression(expression) ? expression.expression : expression);
}

/** The decorators declaring a field: `@Field`, and `@Id` for the key the class names. */
export const FIELD_DECORATORS: ReadonlySet<string | undefined> = new Set(['Field', 'Id']);

/** Where the line holding offset `at` of `text` starts. */
export function lineStartOf(text: string, at: number): number {
  return text.lastIndexOf('\n', at - 1) + 1;
}

/** The whitespace the line holding `node` starts with. */
export function indentOf(node: ts.Node): string {
  const text = node.getSourceFile().text;
  const line = text.slice(lineStartOf(text, node.getStart()), node.getStart());
  return line.slice(0, line.length - line.trimStart().length);
}
