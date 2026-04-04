/**
 * Source code generation for default-export SQL migrations (`SqlQuerier` / `uql-migrate`).
 */

export type SqlMigrationModuleOptions = {
  migrationName: string;
  createdAt: Date;
  /** Extra lines in the file header comment (without leading ` * `). */
  docExtraLines?: string[];
  /** Indented body inside `async up` (including newlines). */
  upInner: string;
  /** Indented body inside `async down` (including newlines). */
  downInner: string;
};

/**
 * Emit one `await querier.run(...)` line for entity-generated migrations.
 * Uses `JSON.stringify` so SQL with backticks (SQLite/LibSQL), quotes, `${`, etc. stays valid TS source.
 */
export function emitSqlRunCall(sql: string): string {
  return /*ts*/ `    await querier.run(${JSON.stringify(sql)});`;
}

/** Indented `up`/`down` body: one `await querier.run(...)` per SQL string (entity-generated migrations, #87). */
export function emitSqlRunCalls(statements: string[]): string {
  return statements.map(emitSqlRunCall).join('\n');
}

/** Body for `up` in a manual (empty) migration scaffold. */
export const EMPTY_MANUAL_MIGRATION_UP_INNER = `    // Add your migration logic here.
    // Use one await querier.run("...") per SQL statement when possible (same style as generate:entities).
    // Example (Postgres):
    // await querier.run("CREATE TABLE \\"users\\" (\\"id\\" SERIAL PRIMARY KEY);");
`;

/** Body for `down` in a manual (empty) migration scaffold. */
export const EMPTY_MANUAL_MIGRATION_DOWN_INNER = `    // Add your rollback logic here.
    // await querier.run("DROP TABLE IF EXISTS \\"users\\";");
`;

/**
 * Full contents of a `export default { async up/down(querier) { ... } }` migration module.
 */
export function buildSqlQuerierMigrationModule(options: SqlMigrationModuleOptions): string {
  const iso = options.createdAt.toISOString();
  const extra = options.docExtraLines?.map((line) => `\n * ${line}`).join('') ?? '';

  return /*ts*/ `import type { SqlQuerier } from 'uql-orm/migrate';

/**
 * Migration: ${options.migrationName}
 * Created: ${iso}${extra}
 */
export default {
  async up(querier: SqlQuerier): Promise<void> {
${options.upInner}
  },

  async down(querier: SqlQuerier): Promise<void> {
${options.downInner}
  },
};
`;
}
