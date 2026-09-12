import { mongoCommandSource } from '../generator/mongoCommand.js';

/**
 * Source code generation for default-export migrations (`uql-migrate`), on a `SqlQuerier` or a `MongoQuerier`.
 */

/** The querier a migration module is written against. */
export type MigrationQuerierType = 'SqlQuerier' | 'MongoQuerier';

export type MigrationModuleOptions = {
  migrationName: string;
  createdAt: Date;
  /** Defaults to `SqlQuerier`. */
  querier?: MigrationQuerierType;
  /** Extra lines in the file header comment (without leading ` * `). */
  docExtraLines?: string[];
  /** Indented body inside `async up` (including newlines). */
  upInner: string;
  /** Indented body inside `async down` (including newlines). */
  downInner: string;
};

/** @deprecated Use {@link MigrationModuleOptions}. */
export type SqlMigrationModuleOptions = MigrationModuleOptions;

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

/** Indented `up`/`down` body: one awaited driver call on `querier.db` per MongoDB command. */
export function emitMongoCommandCalls(statements: string[]): string {
  return statements.map((statement) => /*ts*/ `    await ${mongoCommandSource(statement, 'querier.db')};`).join('\n');
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

/** How a migration on each querier is scaffolded empty, and how a generated statement is spelled in it. */
export const migrationSource = {
  SqlQuerier: {
    emptyUp: EMPTY_MANUAL_MIGRATION_UP_INNER,
    emptyDown: EMPTY_MANUAL_MIGRATION_DOWN_INNER,
    emit: emitSqlRunCalls,
  },
  MongoQuerier: {
    emptyUp: `    // Add your migration logic here, through the database handle.
    // await querier.db.collection('users').updateMany({}, { $set: { active: true } });
`,
    emptyDown: `    // Add your rollback logic here.
    // await querier.db.collection('users').updateMany({}, { $unset: { active: '' } });
`,
    emit: emitMongoCommandCalls,
  },
} satisfies Record<
  MigrationQuerierType,
  { emptyUp: string; emptyDown: string; emit: (statements: string[]) => string }
>;

/**
 * Full contents of a `export default { async up/down(querier) { ... } }` migration module.
 */
export function buildMigrationModule(options: MigrationModuleOptions): string {
  const querier = options.querier ?? 'SqlQuerier';
  const iso = options.createdAt.toISOString();
  const extra = options.docExtraLines?.map((line) => `\n * ${line}`).join('') ?? '';

  return /*ts*/ `import type { ${querier} } from 'uql-orm/migrate';

/**
 * Migration: ${options.migrationName}
 * Created: ${iso}${extra}
 */
export default {
  async up(querier: ${querier}): Promise<void> {
${options.upInner}
  },

  async down(querier: ${querier}): Promise<void> {
${options.downInner}
  },
};
`;
}

/** @deprecated Use {@link buildMigrationModule}. */
export const buildSqlQuerierMigrationModule = buildMigrationModule;
