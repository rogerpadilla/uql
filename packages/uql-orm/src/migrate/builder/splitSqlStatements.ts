/**
 * Splits a SQL blob on semicolons into separate statements.
 *
 * Uses a declarative Master-Regex scanner to rapidly
 * identify and skip "non-splittable" blocks (strings, comments, dollar-quotes) in a single pass.
 * This approach is $O(n)$, leverages native regex speed, and is trivially easy to audit.
 *
 * Handles:
 * - Single quotes: '...' (standard SQL, respects '' and \')
 * - Double quotes: "..." (identifiers or MySQL strings)
 * - Backticks: `...` (MySQL identifiers)
 * - Postgres Dollar quotes: $tag$...$tag$ or $$...$$
 * - Comments: -- and /* ... *\/
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let lastIndex = 0;

  // This regex matches:
  // 1. Single quoted strings: '(?:''|\\['\\]|[^'])*(?:'|(?=$))
  // 2. Double quoted identifiers: "(?:""|\\["\\]|[^"])*(?:"|(?=$))
  // 3. Backticked identifiers: `(?:``|\\[`\\]|[^`])*(?:`|(?=$))
  // 4. Postgres Dollar quoted blocks: \$(?<tag>[a-zA-Z0-9_]*)\$[\s\S]*?(?:\$\k<tag>|(?=$))
  // 5. Single-line comments: --.*
  // 6. Multi-line comments: \/\*[\s\S]*?(?:\*\/|(?=$))
  // 7. Statement terminator: ;
  const masterRegex =
    /'(?:''|\\['\\]|[^'])*(?:'|(?=$))|"(?:""|\\["\\]|[^"])*(?:"|(?=$))|`(?:``|\\[`\\]|[^`])*(?:`|(?=$))|\$(?<tag>[a-zA-Z0-9_]*)\$[\s\S]*?(?:\$\k<tag>|(?=$))|--.*|\/\*[\s\S]*?(?:\*\/|(?=$))|;/g;

  for (const match of sql.matchAll(masterRegex)) {
    if (match[0] === ';') {
      const stmt = sql.substring(lastIndex, match.index ?? 0).trim();
      if (stmt) {
        statements.push(stmt);
      }
      lastIndex = (match.index ?? 0) + match[0].length;
    }
  }

  const lastStmt = sql.substring(lastIndex).trim();
  if (lastStmt) {
    statements.push(lastStmt);
  }

  return statements;
}

/** Legacy alias kept for backward compatibility. */
export const splitSqlStatementsOnSemicolons = splitSqlStatements;
