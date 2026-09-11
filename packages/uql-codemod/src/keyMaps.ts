import ts from 'typescript';
import type { Edit } from './edits.js';

// What replaced member names written as strings: a key-map callback where a definition names them
// (`@Index` columns and `include`, `mappedBy`, `references`, `hooks`), a `{ field: true }` key where a
// statement does. Each builder returns its edit, or nothing where the value is not a literal it can
// read, which its caller reports.

/** A node and the text it becomes, or `undefined` when it could not be read. */
type Part = readonly [node: ts.Node, text: string | undefined];
type ReadPart = readonly [node: ts.Node, text: string];

/** A callback's parameter, named after the class it reads: `Post` -> `post`. */
export function paramFor(className: string | undefined): string {
  return className ? className[0].toLowerCase() + className.slice(1) : 'entity';
}

function isIdentifierName(key: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(key);
}

/** `post.title`, or `post['first-name']` for a key that is no identifier. */
function memberAccess(param: string, key: string): string {
  return isIdentifierName(key) ? `${param}.${key}` : `${param}['${key}']`;
}

/** A key's name where it is spelled out, which is every form but a computed one (`{ [k]: v }`). */
export function propertyKey(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** The initializer of the property `name` in an object literal, however its key is written. */
export function propertyValue(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = node.properties.find(
    (prop): prop is ts.PropertyAssignment => ts.isPropertyAssignment(prop) && propertyKey(prop.name) === name,
  );
  return property?.initializer;
}

/** `'amount'` or `['title', 'body']` -> `{ amount: true }`, the key map a statement names fields by. */
export function fieldKeysEdit(value: ts.Expression): Edit | undefined {
  const names: readonly ts.Expression[] = ts.isArrayLiteralExpression(value) ? value.elements : [value];
  if (!names.every((name): name is ts.StringLiteralLike => ts.isStringLiteralLike(name))) {
    return undefined;
  }
  const keys = names.map(({ text }) => `${isIdentifierName(text) ? text : `'${text}'`}: true`);
  return replaced(value, `{ ${keys.join(', ')} }`);
}

/** Whether `value` is already a function, the form every rewrite here produces. */
export function isCallback(value: ts.Expression): boolean {
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value);
}

/** `['title', { column: 'createdAt' }]` -> `(post) => [post.title, { column: post.createdAt }]`. */
export function keyListEdit(list: ts.Expression, param: string): Edit | undefined {
  const text = ts.isArrayLiteralExpression(list)
    ? spliced(
        list,
        list.elements.map((entry) => [entry, keyListEntry(entry, param)]),
      )
    : undefined;
  return callbackEdit(list, param, text);
}

/** `'author'` -> `(post) => post.author`, `param` being the relation's target. */
export function mappedByEdit(value: ts.Expression, param: string): Edit | undefined {
  return callbackEdit(value, param, ts.isStringLiteralLike(value) ? memberAccess(param, value.text) : undefined);
}

/**
 * `[{ local: 'customerCode', foreign: 'code' }]` -> `(order, customer) => [{ local: order.customerCode,
 * foreign: customer.code }]`. A self-relation would give both parameters one name, so it reads
 * `(local, foreign)` instead.
 */
export function referencesEdit(value: ts.Expression, owner: string, target: string): Edit | undefined {
  const [local, foreign] = owner === target ? ['local', 'foreign'] : [owner, target];
  const text = ts.isArrayLiteralExpression(value)
    ? spliced(
        value,
        value.elements.map((pair) => [pair, referenceText(pair, local, foreign)]),
      )
    : undefined;
  return callbackEdit(value, `${local}, ${foreign}`, text);
}

/** The class an `entity: () => Post` getter returns, as written. */
export function entityGetterTarget(relation: ts.ObjectLiteralExpression): string | undefined {
  const getter = propertyValue(relation, 'entity');
  return getter && ts.isArrowFunction(getter) && ts.isIdentifier(getter.body) ? getter.body.text : undefined;
}

/** An expression entry (`raw\`...\``) and a `column` that is not a string stay as written. */
function keyListEntry(entry: ts.Expression, param: string): string | undefined {
  if (ts.isStringLiteralLike(entry)) {
    return memberAccess(param, entry.text);
  }
  if (ts.isTaggedTemplateExpression(entry) || ts.isCallExpression(entry)) {
    return entry.getText();
  }
  if (!ts.isObjectLiteralExpression(entry)) {
    return undefined;
  }
  const column = propertyValue(entry, 'column');
  return column && ts.isStringLiteralLike(column)
    ? spliced(entry, [[column, memberAccess(param, column.text)]])
    : entry.getText();
}

function referenceText(pair: ts.Expression, local: string, foreign: string): string | undefined {
  if (!ts.isObjectLiteralExpression(pair)) {
    return undefined;
  }
  const localKey = propertyValue(pair, 'local');
  const foreignKey = propertyValue(pair, 'foreign');
  return localKey && foreignKey && ts.isStringLiteralLike(localKey) && ts.isStringLiteralLike(foreignKey)
    ? spliced(pair, [
        [localKey, memberAccess(local, localKey.text)],
        [foreignKey, memberAccess(foreign, foreignKey.text)],
      ])
    : undefined;
}

/** `node`'s text with each part swapped for its own, everything between kept as written. */
function spliced(node: ts.Node, parts: readonly Part[]): string | undefined {
  if (!parts.every((part): part is ReadPart => part[1] !== undefined)) {
    return undefined;
  }
  const start = node.getStart();
  const source = node.getText();
  const sorted = [...parts].sort(([a], [b]) => a.getStart() - b.getStart());
  const { text, at } = sorted.reduce(
    (acc, [part, replacement]) => ({
      text: acc.text + source.slice(acc.at, part.getStart() - start) + replacement,
      at: part.getEnd() - start,
    }),
    { text: '', at: 0 },
  );
  return text + source.slice(at);
}

/** `value` replaced by `(params) => body`, or nothing when the body could not be read. */
function callbackEdit(value: ts.Node, params: string, body: string | undefined): Edit | undefined {
  return body === undefined ? undefined : replaced(value, `(${params}) => ${body}`);
}

export function replaced(node: ts.Node, text: string): Edit {
  return { start: node.getStart(), end: node.getEnd(), text };
}
