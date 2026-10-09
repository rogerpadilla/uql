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

/** The property `name` of an object literal, a shorthand included. */
export function namedProperty(node: ts.ObjectLiteralExpression, name: string): NamedProperty | undefined {
  return node.properties.find(
    (prop): prop is NamedProperty =>
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && propertyKey(prop.name) === name,
  );
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

/** The elements of an array literal, or none where `node` is not one. */
export function arrayElements(node: ts.Expression | undefined): readonly ts.Expression[] {
  return node && ts.isArrayLiteralExpression(node) ? node.elements : [];
}

/** `node` where it is an object literal. */
export function objectLiteral(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  return node && ts.isObjectLiteralExpression(node) ? node : undefined;
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
