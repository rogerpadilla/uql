import ts from 'typescript';
import { type Edit, inserted, replaced } from './edits.js';

// What replaced member names written as strings: a callback where a definition names them, reading refs
// (`@Index` columns and `include`) or the key map (`mappedBy`, `references`, `hooks`), and a `{ field: true }`
// key where a statement does. Each builder edits only the parts that change, so a rewrite nested in one keeps
// its own, and returns nothing where the value is not a literal it can read, which its caller reports.

/** The edits of one rewrite, or `undefined` where the value it reads could not be read. */
export type Edits = readonly Edit[] | undefined;

/** A callback's parameter, named after the class it reads: `Post` -> `post`. */
export function paramFor(className: string | undefined): string {
  return className ? className[0].toLowerCase() + className.slice(1) : 'entity';
}

function isIdentifierName(key: string): boolean {
  return /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u.test(key);
}

/** `text` as a single-quoted string literal, escaping what would end it. */
export function quoted(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** `post.title`, or `post['first-name']` for a key that is no identifier. */
export function memberAccess(param: string, key: string): string {
  return isIdentifierName(key) ? `${param}.${key}` : `${param}[${quoted(key)}]`;
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
export function fieldKeysEdits(value: ts.Expression): Edits {
  const names: readonly ts.Expression[] = ts.isArrayLiteralExpression(value) ? value.elements : [value];
  if (!names.every((name): name is ts.StringLiteralLike => ts.isStringLiteralLike(name))) {
    return undefined;
  }
  const keys = names.map(({ text }) => `${isIdentifierName(text) ? text : quoted(text)}: true`);
  return [replaced(value, `{ ${keys.join(', ')} }`)];
}

/** Whether `value` is already a function, the form every rewrite here produces. */
export function isCallback(value: ts.Expression): boolean {
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value);
}

/** `['title', { column: 'createdAt' }]` -> `(post) => [post.title, { column: post.createdAt }]`. */
export function keyListEdits(list: ts.Expression, param: string): Edits {
  return ts.isArrayLiteralExpression(list)
    ? callbackEdits(
        list,
        param,
        list.elements.map((entry) => keyListEntryEdits(entry, param)),
      )
    : undefined;
}

/** `'author'` -> `(post) => post.author`, `param` being the relation's target. */
export function mappedByEdits(value: ts.Expression, param: string): Edits {
  return ts.isStringLiteralLike(value)
    ? [replaced(value, `(${param}) => ${memberAccess(param, value.text)}`)]
    : undefined;
}

/**
 * `[{ local: 'customerCode', foreign: 'code' }]` -> `(order, customer) => [{ local: order.customerCode,
 * foreign: customer.code }]`. A self-relation would give both parameters one name, so it reads
 * `(local, foreign)` instead.
 */
export function referencesEdits(value: ts.Expression, owner: string, target: string): Edits {
  const [local, foreign] = owner === target ? ['local', 'foreign'] : [owner, target];
  return ts.isArrayLiteralExpression(value)
    ? callbackEdits(
        value,
        `${local}, ${foreign}`,
        value.elements.map((pair) => referenceEdits(pair, local, foreign)),
      )
    : undefined;
}

/** The class an `entity: () => Post` getter returns, as written. */
export function entityGetterTarget(relation: ts.ObjectLiteralExpression): string | undefined {
  const getter = propertyValue(relation, 'entity');
  return getter && ts.isArrowFunction(getter) && ts.isIdentifier(getter.body) ? getter.body.text : undefined;
}

/** A column-list entry, its name read off the refs: an expression, or a `column` given otherwise, has none. */
function keyListEntryEdits(entry: ts.Expression, param: string): Edits {
  if (ts.isStringLiteralLike(entry)) {
    return [replaced(entry, memberAccess(param, entry.text))];
  }
  if (ts.isTaggedTemplateExpression(entry) || ts.isCallExpression(entry)) {
    return [];
  }
  if (!ts.isObjectLiteralExpression(entry)) {
    return undefined;
  }
  const column = propertyValue(entry, 'column');
  return column && ts.isStringLiteralLike(column) ? [replaced(column, memberAccess(param, column.text))] : [];
}

function referenceEdits(pair: ts.Expression, local: string, foreign: string): Edits {
  if (!ts.isObjectLiteralExpression(pair)) {
    return undefined;
  }
  const localKey = propertyValue(pair, 'local');
  const foreignKey = propertyValue(pair, 'foreign');
  return localKey && foreignKey && ts.isStringLiteralLike(localKey) && ts.isStringLiteralLike(foreignKey)
    ? [
        replaced(localKey, memberAccess(local, localKey.text)),
        replaced(foreignKey, memberAccess(foreign, foreignKey.text)),
      ]
    : undefined;
}

/** `(params) => ` before `body`, with the edits of its parts, or nothing where one could not be read. */
function callbackEdits(body: ts.Node, params: string, parts: readonly Edits[]): Edits {
  return parts.every((part): part is readonly Edit[] => part !== undefined)
    ? [inserted(body, `(${params}) => `), ...parts.flat()]
    : undefined;
}
