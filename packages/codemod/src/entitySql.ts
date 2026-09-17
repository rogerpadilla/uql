import ts from 'typescript';
import { type Edit, inserted, replaced } from './edits.js';
import { propertyValue } from './keyMaps.js';

// What replaced SQL a definition writes as text: an index expression is `raw` in its list, reading the
// list's refs, and a partial-index `where` is `raw` or a predicate, never a string. SQL still naming a
// column by hand is only noted: which member it meant is its author's to say.

/** `raw\`...\`` or `raw(...)`. */
type RawSql = ts.TaggedTemplateExpression | ts.CallExpression;

export function isRaw(node: ts.Node): node is RawSql {
  const callee = ts.isTaggedTemplateExpression(node)
    ? node.tag
    : ts.isCallExpression(node)
      ? node.expression
      : undefined;
  return callee !== undefined && ts.isIdentifier(callee) && callee.text === 'raw';
}

/** The expressions of a column list, written as one or returned by its callback: each entry or `column` that is `raw`. */
export function columnExpressions(list: ts.Expression | undefined): readonly RawSql[] {
  const body = list && ts.isArrowFunction(list) ? list.body : list;
  const entries: readonly ts.Expression[] = body && ts.isArrayLiteralExpression(body) ? body.elements : [];
  return entries.flatMap((entry) => {
    const sql = ts.isObjectLiteralExpression(entry) ? propertyValue(entry, 'column') : entry;
    return sql && isRaw(sql) ? [sql] : [];
  });
}

/** SQL text as a `raw` tagged template, escaping what would end or interpolate it. */
export function rawTag(sql: string): string {
  return `raw\`${sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;
}

/** A partial-index `where` string as `raw`, or nothing for a template that interpolates, whose values `raw` would bind. */
export function rawWhereEdit(where: ts.Expression): Edit | undefined {
  if (ts.isNoSubstitutionTemplateLiteral(where)) {
    return inserted(where, 'raw');
  }
  return ts.isStringLiteral(where) ? replaced(where, rawTag(where.text)) : undefined;
}

/**
 * The columns SQL names by hand, which a rename does not reach: each quoted identifier, and each bare word
 * naming one of `members`. What a string literal holds is left out, as is a word called as a function.
 */
export function handNamedColumns(sql: ts.Expression, members: ReadonlySet<string>): readonly string[] {
  const code = sqlText(sql)?.replace(/'(?:[^']|'')*'/g, "''") ?? '';
  const quoted = Array.from(code.matchAll(/"[^"]+"|`[^`]+`/g), ([token]) => token.slice(1, -1));
  const bare = Array.from(code.matchAll(/\b[A-Za-z_]\w*\b(?!\s*\()/g), ([word]) => word);
  return [...new Set([...quoted, ...bare.filter((word) => members.has(word))])];
}

/** The text of a `raw` or a string, `?` standing in for each interpolation. */
function sqlText(sql: ts.Node | undefined): string | undefined {
  if (!sql) {
    return undefined;
  }
  if (isRaw(sql)) {
    return sqlText(ts.isTaggedTemplateExpression(sql) ? sql.template : sql.arguments[0]);
  }
  if (ts.isTemplateExpression(sql)) {
    return [sql.head, ...sql.templateSpans.map((span) => span.literal)].map((part) => part.text).join(' ? ');
  }
  return ts.isStringLiteralLike(sql) ? sql.text : undefined;
}
