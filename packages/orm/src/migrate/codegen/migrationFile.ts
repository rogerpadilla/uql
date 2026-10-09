import { mongoCommandSource } from '../../mongodb/mongoCommand.js';

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

/**
 * One `await querier.run`...`` line, the SQL a template binding nothing, so its lines and quotes read as
 * written; a backslash, a backtick and a `${` are escaped.
 */
export function emitSqlRunCall(sql: string): string {
  return /*ts*/ `    await querier.run\`${sql.replace(/[\\`]|\$\{/g, (char) => `\\${char}`)}\`;`;
}

/** Indented `up`/`down` body: one `await querier.run`...`` per SQL string. */
export function emitSqlRunCalls(statements: string[]): string {
  return statements.map(emitSqlRunCall).join('\n');
}

/** Indented `up`/`down` body: one awaited driver call on `querier.db` per MongoDB command. */
export function emitMongoCommandCalls(statements: string[]): string {
  return statements.map((statement) => /*ts*/ `    await ${mongoCommandSource(statement, 'querier.db')};`).join('\n');
}

/** How a migration on one querier is scaffolded empty, and how a generated statement is spelled in it. */
export type MigrationSource = {
  readonly querier: MigrationQuerierType;
  /** The entry the querier type is imported from: only `uql-orm/mongodb` names the driver's `Db`. */
  readonly entry: string;
  readonly emptyUp: string;
  readonly emptyDown: string;
  emit(statements: string[]): string;
};

export const migrationSource = {
  SqlQuerier: {
    querier: 'SqlQuerier',
    entry: 'uql-orm',
    emptyUp: `    // Add your migration logic here: one await querier.run\`...\` per SQL statement.
    // Example (Postgres):
    // await querier.run\`CREATE TABLE "users" ("id" SERIAL PRIMARY KEY)\`;
`,
    emptyDown: `    // Add your rollback logic here.
    // await querier.run\`DROP TABLE IF EXISTS "users"\`;
`,
    emit: emitSqlRunCalls,
  },
  MongoQuerier: {
    querier: 'MongoQuerier',
    entry: 'uql-orm/mongodb',
    emptyUp: `    // Add your migration logic here, through the database handle.
    // await querier.db.collection('users').updateMany({}, { $set: { active: true } });
`,
    emptyDown: `    // Add your rollback logic here.
    // await querier.db.collection('users').updateMany({}, { $unset: { active: '' } });
`,
    emit: emitMongoCommandCalls,
  },
} satisfies Record<MigrationQuerierType, MigrationSource>;

/**
 * Full contents of a `export default { async up/down(querier) { ... } }` migration module.
 */
export function buildMigrationModule(options: MigrationModuleOptions): string {
  const querier = options.querier ?? 'SqlQuerier';
  const iso = options.createdAt.toISOString();
  const extra = options.docExtraLines?.map((line) => `\n * ${line}`).join('') ?? '';

  return /*ts*/ `import type { ${querier} } from '${migrationSource[querier].entry}';

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
