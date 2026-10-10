import ts from 'typescript';
import { type Edit, inserted, type Part, replaced, type Span } from './edits.js';
import { isSqlExport, uqlExport } from './imports.js';
import { propertyValue } from './syntax.js';

// What replaced SQL a definition writes as text: an index expression is `sql` in its list, reading the
// list's refs, and a partial-index `where` is `sql` or a predicate, never a string. SQL still naming a
// column by hand is only noted: which member it meant is its author's to say.

/** `sql\`...\`` or `sql(...)`, or the deprecated `raw` of either. */
type SqlCall = ts.TaggedTemplateExpression | ts.CallExpression;

export function isSqlCall(node: ts.Node, checker: ts.TypeChecker): node is SqlCall {
  const callee = ts.isTaggedTemplateExpression(node)
    ? node.tag
    : ts.isCallExpression(node)
      ? node.expression
      : undefined;
  return isSqlExport(uqlExport(callee, checker));
}

/** The expressions of a column list, written as one or returned by its callback: each entry or `column` that is `sql`. */
export function columnExpressions(list: ts.Expression | undefined, checker: ts.TypeChecker): readonly SqlCall[] {
  const body = list && ts.isArrowFunction(list) ? list.body : list;
  const entries: readonly ts.Expression[] = body && ts.isArrayLiteralExpression(body) ? body.elements : [];
  return entries.flatMap((entry) => {
    const sql = ts.isObjectLiteralExpression(entry) ? propertyValue(entry, 'column') : entry;
    return sql && isSqlCall(sql, checker) ? [sql] : [];
  });
}

/** SQL text as a template tagged by `name`, escaping what would end or interpolate it. */
export function sqlTag(name: string, sql: string): string {
  return `${name}${templateOf(sql)}`;
}

/** `text` as a template literal binding nothing: a backslash, a backtick and a `${` in it are escaped. */
export function templateOf(text: string): string {
  return `\`${escapedIn(text)}\``;
}

/** A template literal reading `texts`, the `values` kept from the original interpolated between them. */
export function templateWith(texts: readonly string[], values: readonly Span[]): readonly Part[] {
  const [first, ...rest] = texts.map(escapedIn);
  return ['`', first, ...rest.flatMap((text, at) => ['${', values[at], '}', text]), '`'];
}

function escapedIn(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** A partial-index `where` string as `sql`, or nothing for a template that interpolates, whose values `sql` would bind. */
export function sqlWhereEdit(where: ts.Expression, name: string): Edit | undefined {
  if (ts.isNoSubstitutionTemplateLiteral(where)) {
    return inserted(where, name);
  }
  return ts.isStringLiteral(where) ? replaced(where, sqlTag(name, where.text)) : undefined;
}

/**
 * The columns SQL names by hand, which a rename does not reach: each quoted identifier, and each bare word
 * naming one of `members`. What a string literal holds is left out, as is a word called as a function.
 */
export function handNamedColumns(
  sql: ts.Expression,
  members: ReadonlySet<string>,
  checker: ts.TypeChecker,
): readonly string[] {
  const code = sqlText(sql, checker)?.replace(/'(?:[^']|'')*'/g, "''") ?? '';
  const quoted = Array.from(code.matchAll(/"[^"]+"|`[^`]+`/g), ([token]) => token.slice(1, -1));
  const bare = Array.from(code.matchAll(/\b[A-Za-z_]\w*\b(?!\s*\()/g), ([word]) => word);
  return [...new Set([...quoted, ...bare.filter((word) => members.has(word))])];
}

/** The text of a `sql` or a string, `?` standing in for each interpolation. */
function sqlText(sql: ts.Node | undefined, checker: ts.TypeChecker): string | undefined {
  if (!sql) {
    return undefined;
  }
  if (isSqlCall(sql, checker)) {
    return sqlText(ts.isTaggedTemplateExpression(sql) ? sql.template : sql.arguments[0], checker);
  }
  if (ts.isTemplateExpression(sql)) {
    return [sql.head, ...sql.templateSpans.map((span) => span.literal)].map((part) => part.text).join(' ? ');
  }
  return ts.isStringLiteralLike(sql) ? sql.text : undefined;
}
