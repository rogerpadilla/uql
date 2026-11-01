import ts from 'typescript';
import { applyEdits, type Edit } from './edits.js';
import { type ChainMethod, chainOf } from './syntax.js';

type Key = { readonly name: string; readonly column: ts.Expression };

/** The columns a class's `@Field`s declare, by property. */
function classColumns(node: ts.ClassLikeDeclaration): Key[] {
  return node.members
    .filter(ts.isPropertyDeclaration)
    .flatMap((member) =>
      (ts.getDecorators(member) ?? []).flatMap(({ expression }) =>
        ts.isCallExpression(expression) && expression.expression.getText() === 'Field'
          ? [{ name: member.name.getText(), column: expression.arguments[0] }]
          : [],
      ),
    );
}

/** The columns a `fields` object declares, by property. */
function fieldColumns(node: ts.ObjectLiteralExpression): Key[] {
  return node.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => ({ name: property.name.getText(), column: property.initializer }));
}

/** The whole statement a `fields` object is in, whose chained `.relations()` may read its key. */
function statementOf(node: ts.Node): ts.Node {
  return ts.isStatement(node) || ts.isSourceFile(node.parent) ? node : statementOf(node.parent);
}

/** `method`, dot included, as `text`. */
function written({ receiver, call }: ChainMethod, text: string): Edit {
  return { start: receiver.getEnd(), end: call.getEnd(), text };
}

/** The `.autoIncrement()` of a column no key, which generated nothing and would now make it one. */
function inertAutoIncrement(column: ts.Expression): Edit[] {
  const { methods } = chainOf(column);
  const inert = methods.find(({ name }) => name === 'autoIncrement');
  return inert && !methods.some(({ name }) => name === 'id') ? [written(inert, '')] : [];
}

/** `.autoIncrement()` in place of `.id()` on the sole numeric key of `scope`, which the database no longer generates unasked. */
function stateKey(keys: readonly Key[], scope: ts.Node): Edit[] {
  const ids = keys.filter(({ column }) => chainOf(column).methods.some(({ name }) => name === 'id'));
  const inert = ids.length ? keys.flatMap(({ column }) => inertAutoIncrement(column)) : [];
  if (ids.length !== 1) return inert;
  const [{ name: key, column }] = ids;
  const { root, methods } = chainOf(column);
  const names = methods.map(({ name }) => name);
  const [type] = methods;
  const numeric =
    ['number', 'bigint'].includes(type.name) ||
    (type.name === 'column' && /\b(?:tiny|small|medium|big)?(?:int\d?|integer|serial)\b/i.test(type.call.getText()));
  const shared = new RegExp(`references:\\s*\\(?\\w+\\)?\\s*=>\\s*\\w+\\.${key}\\b`).test(scope.getText());
  const filled = ['references', 'onInsert', 'default'].some((method) => names.includes(method));
  const declared = methods.some(({ name, call }) => name === 'autoIncrement' && call.arguments.length);
  if (root.getText() !== 'f' || !numeric || filled || declared || shared) return inert;
  return [...inert, written(methods[names.indexOf('id')], names.includes('autoIncrement') ? '' : '.autoIncrement()')];
}

/**
 * States each generated key, which `.id()` no longer implies: a sole numeric key filled by nothing else and not
 * shared with a row it references. Off the text the builders wrote, so it sees every column as one.
 */
export function toGeneratedKeys(fileName: string, text: string): string {
  if (!text.includes('.id()') && !text.includes('.autoIncrement(false)')) return text;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const edits: Edit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) {
      edits.push(...stateKey(classColumns(node), node));
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'fields' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      edits.push(...stateKey(fieldColumns(node.initializer), statementOf(node)));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'autoIncrement' &&
      node.arguments[0]?.getText() === 'false'
    ) {
      edits.push({ start: node.expression.expression.getEnd(), end: node.getEnd(), text: '' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return applyEdits(text, edits);
}
