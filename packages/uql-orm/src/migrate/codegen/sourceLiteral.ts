/** Whether `text` can name a property unquoted, in any script: `dueño` can, `first-name` cannot. */
export function isIdentifierName(text: string): boolean {
  return /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u.test(text);
}

/**
 * A string as single-quoted source. Introspected text is arbitrary - a comment or a default
 * expression can hold a quote or a backslash - and only escaping both keeps the generated file
 * parsing.
 */
export function quoted(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * SQL as a `raw` tagged template. A database reprints an expression as arbitrary text, and exactly
 * three sequences can end or interpolate a template literal, so escaping those is the whole job.
 * Newlines need none, which keeps a multi-line expression readable in the generated entity.
 */
export function rawTag(sql: string): string {
  const escaped = sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `raw\`${escaped}\``;
}
