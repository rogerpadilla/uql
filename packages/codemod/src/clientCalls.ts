import ts from 'typescript';
import type { Context } from './context.js';
import { original, replaced } from './edits.js';

/** The browser client's types: what each of its reads and writes once resolved to an envelope. */
const CLIENTS: ReadonlySet<string> = new Set(['HttpQuerier', 'ClientQuerier']);

/** The method of uql's browser client `call` makes, `undefined` for any other call. */
function clientMethod(call: ts.CallExpression, ctx: Context): string | undefined {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  const declarations = ctx.checker.getSymbolAtLocation(callee.name)?.declarations ?? [];
  if (!declarations.some((it) => it.getSourceFile().fileName.includes('/node_modules/uql-orm/'))) {
    return undefined;
  }
  const receiver = ctx.checker.getTypeAtLocation(callee.expression);
  const name = receiver.getSymbol()?.getName();
  return name && CLIENTS.has(name) ? callee.name.text : undefined;
}

/** What each envelope key a result read reads now: the value itself, or where `findManyAndCount`'s pair holds it. */
const ENVELOPE: ReadonlyMap<string, string> = new Map([['data', '']]);
const PAIR: ReadonlyMap<string, string> = new Map([
  ['data', '[0]'],
  ['count', '[1]'],
]);

/** `node` with the parentheses around it, the expression its parent reads. */
function outermost(node: ts.Node): ts.Node {
  return ts.isParenthesizedExpression(node.parent) ? outermost(node.parent) : node;
}

/** The binding of `key` in `pattern`, as `{ key }` or `{ key: local }` write it. */
function bindingOf(pattern: ts.ObjectBindingPattern, key: string): ts.BindingElement | undefined {
  return pattern.elements.find((element) => (element.propertyName ?? element.name).getText() === key);
}

/**
 * `await client.findMany(...)`, which resolved to `{ data, count }` and now resolves to the value, as the pool's
 * does: `(await ...).data` loses its `.data` (a `findManyAndCount`'s reads `[0]`, its `.count` `[1]`), `const { data: users } = await ...` becomes `const users = await ...`,
 * and a `findManyAndCount`'s `{ data, count }` its `[data, count]`, a pair. Any other read of the result is reported.
 */
export function rewriteClientAwait(node: ts.AwaitExpression, ctx: Context): void {
  const call = node.expression;
  const method = ts.isCallExpression(call) ? clientMethod(call, ctx) : undefined;
  if (!method) {
    return;
  }
  const pair = method === 'findManyAndCount';
  const read = outermost(node);
  const parent = read.parent;
  // A result nobody reads, such as a delete's, changes nothing.
  if (ts.isExpressionStatement(parent)) {
    return;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === read) {
    const at = (pair ? PAIR : ENVELOPE).get(parent.name.text);
    if (at !== undefined) {
      ctx.edits.push(replaced(parent, [original(read), at]));
      return;
    }
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === read && ts.isObjectBindingPattern(parent.name)) {
    const pattern = parent.name;
    const data = bindingOf(pattern, 'data');
    const count = bindingOf(pattern, 'count');
    const bound = [data, count].filter(Boolean).length;
    if (pair && bound && bound === pattern.elements.length) {
      const rows = data ? [original(data.name)] : [];
      const total = count ? [', ', original(count.name)] : [];
      ctx.edits.push(replaced(pattern, ['[', ...rows, ...total, ']']));
      return;
    }
    if (data && pattern.elements.length === 1 && !pair) {
      ctx.edits.push(replaced(pattern, [original(data.name)]));
      return;
    }
  }
  ctx.report(
    node,
    `'${method}' answers the value now, not \`{ data, count }\`: read its result as it is` +
      (pair ? ', `[rows, count]`' : ''),
  );
}
