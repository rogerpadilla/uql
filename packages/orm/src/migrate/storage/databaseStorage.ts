import type { Querier, QuerySql, SqlQuerier } from '../../type/index.js';
import { currentTimestamp, sql } from '../../util/sql.js';
import { tableBuilder } from '../builder/tableBuilder.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

/** Where executed migrations are recorded when the config does not name a table. */
export const DEFAULT_MIGRATIONS_TABLE = 'uql_migrations';

/**
 * The journal record a run holds the lock by where the engine has no named lock (`migrationLock.ts`). No
 * file name holds a slash, so no migration is named so.
 */
export const LOCK_RECORD = 'uql/lock';

/** The journal of the migrations run, each call on the querier the run holds the lock with. */
export interface MigrationStorage {
  executed(querier: Querier): Promise<string[]>;
  /** Inside the migration's transaction, where it has one. */
  logWithQuerier(querier: Querier, migrationName: string): Promise<void>;
  unlogWithQuerier(querier: Querier, migrationName: string): Promise<void>;
}

/**
 * Creates the journal `tableName` where it is missing, rendered by the schema generator rather than written out: SQL
 * Server has no `CREATE TABLE IF NOT EXISTS`, and its `TIMESTAMP` is a row version that takes no default. It precedes
 * the lock, so a run creating it beside another can lose that race in the catalogue: it asks once more, finding it.
 */
export async function createMigrationsTable(querier: SqlQuerier, tableName: string): Promise<void> {
  const table = tableBuilder(tableName);
  table.string('name').id();
  table.timestamptz('executed_at').default(currentTimestamp);
  const statements = new SqlSchemaGenerator(querier.dialect).generateCreateTableFromDefinition(table.build(), {
    ifNotExists: true,
  });
  const create = async () => {
    for (const statement of statements) {
      await querier.run(sql.text(statement));
    }
  };
  await create().catch(create);
}

/** Records the migrations run in a table, on the querier each call is handed, which the lock created. */
export class DatabaseMigrationStorage implements MigrationStorage {
  private readonly tableName: string;

  constructor(options: { tableName?: string } = {}) {
    this.tableName = options.tableName ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /** The names recorded, the lock's left out. */
  async executed(querier: SqlQuerier): Promise<string[]> {
    const { table, name } = journalIds(this.tableName);
    const rows = await querier.all<{
      name: string;
    }>`SELECT ${name} FROM ${table} WHERE ${name} <> ${LOCK_RECORD} ORDER BY ${name} ASC`;
    return rows.map((row) => row.name);
  }

  /** Records `migrationName` as run, on the querier that ran it, inside its transaction where there is one. */
  async logWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    const { table, name } = journalIds(this.tableName);
    await querier.run`INSERT INTO ${table} (${name}) VALUES (${migrationName})`;
  }

  /** Removes the record of `migrationName`, on the querier that reverted it. */
  async unlogWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    const { table, name } = journalIds(this.tableName);
    await querier.run`DELETE FROM ${table} WHERE ${name} = ${migrationName}`;
  }
}

/** The journal `tableName` and its one column, escaped as the engine rendering them spells them. */
export function journalIds(tableName: string): { table: QuerySql; name: QuerySql } {
  return {
    table: sql(({ dialect }) => dialect.escapeId(tableName)),
    name: sql(({ dialect }) => dialect.escapeId('name')),
  };
}
