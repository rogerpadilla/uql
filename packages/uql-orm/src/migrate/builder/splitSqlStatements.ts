/**
 * Split a SQL blob on semicolons for execution as separate statements.
 *
 * **Heuristic only:** unsafe if a statement contains `;` inside a string literal. Migration builder
 * operations emit DDL without embedded semicolons in literals; `createTable` bypasses this and uses
 * `string[]` from the schema generator instead (#87).
 */
export function splitSqlStatementsOnSemicolons(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
