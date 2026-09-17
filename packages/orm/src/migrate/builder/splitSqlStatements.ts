/** Splits SQL on semicolons, skipping strings, quoted identifiers, dollar-quoted blocks and comments in one regex pass. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let lastIndex = 0;

  // Quoted strings and identifiers, dollar quotes, comments, or a `;`: the one regex scanning them all.
  const masterRegex =
    /'(?:''|\\['\\]|[^'])*(?:'|(?=$))|"(?:""|\\["\\]|[^"])*(?:"|(?=$))|`(?:``|\\[`\\]|[^`])*(?:`|(?=$))|\$(?<tag>[a-zA-Z0-9_]*)\$[\s\S]*?(?:\$\k<tag>|(?=$))|--.*|\/\*[\s\S]*?(?:\*\/|(?=$))|;/g;

  for (const match of sql.matchAll(masterRegex)) {
    if (match[0] === ';') {
      const stmt = sql.substring(lastIndex, match.index).trim();
      if (stmt) {
        statements.push(stmt);
      }
      lastIndex = match.index + match[0].length;
    }
  }

  const lastStmt = sql.substring(lastIndex).trim();
  if (lastStmt) {
    statements.push(lastStmt);
  }

  return statements;
}
