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

/** `user.email`, or `user['first-name']` for a property name that is no identifier. */
export function memberSource(param: string, property: string): string {
  return isIdentifierName(property) ? `${param}.${property}` : `${param}[${quoted(property)}]`;
}

/**
 * SQL as a template literal binding nothing. A database reprints an expression as arbitrary text, and
 * exactly three sequences can end or interpolate a template, so escaping those is the whole job. Newlines
 * need none, which keeps multi-line SQL readable in the generated file.
 */
export function templateOf(sql: string): string {
  return `\`${sql.replace(/[\\`]|\$\{/g, (char) => `\\${char}`)}\``;
}

/** SQL as a `raw` tagged template. */
export function rawTag(sql: string): string {
  return `raw${templateOf(sql)}`;
}
