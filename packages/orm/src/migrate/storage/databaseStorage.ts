import type { Querier, QueryRaw, SqlQuerier } from '../../type/index.js';
import { currentTimestamp, raw } from '../../util/raw.js';
import { TableDefinitionBuilder } from '../builder/tableBuilder.js';
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
 * Creates the journal `tableName` where it is missing, rendered by the schema generator rather than written
 * out: SQL Server has no `CREATE TABLE IF NOT EXISTS`, and its `TIMESTAMP` is a row version that takes no
 * default. Run under the migration lock, so two runs never race to create it.
 */
export async function createMigrationsTable(querier: SqlQuerier, tableName: string): Promise<void> {
  const table = new TableDefinitionBuilder(tableName);
  table.string('name', { length: 255, primaryKey: true });
  table.timestamptz('executed_at', { defaultValue: currentTimestamp });
  const generator = new SqlSchemaGenerator(querier.dialect);
  for (const sql of generator.generateCreateTableFromDefinition(table.build(), { ifNotExists: true })) {
    await querier.run(raw.text(sql));
  }
}

/** Records the migrations run in a table, on the querier each call is handed, which the lock created. */
export class DatabaseMigrationStorage implements MigrationStorage {
  private readonly tableName: string;

  constructor(options: { tableName?: string } = {}) {
    this.tableName = options.tableName ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /** The names recorded, the lock's left out. */
  async executed(querier: SqlQuerier): Promise<string[]> {
    const { table, name } = journalIds(querier, this.tableName);
    const rows = await querier.all<{
      name: string;
    }>`SELECT ${name} FROM ${table} WHERE ${name} <> ${LOCK_RECORD} ORDER BY ${name} ASC`;
    return rows.map((row) => row.name);
  }

  /** Records `migrationName` as run, on the querier that ran it, inside its transaction where there is one. */
  async logWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    const { table, name } = journalIds(querier, this.tableName);
    await querier.run`INSERT INTO ${table} (${name}) VALUES (${migrationName})`;
  }

  /** Removes the record of `migrationName`, on the querier that reverted it. */
  async unlogWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    const { table, name } = journalIds(querier, this.tableName);
    await querier.run`DELETE FROM ${table} WHERE ${name} = ${migrationName}`;
  }
}

/** The journal `tableName` and its one column, escaped as `querier`'s engine spells them. */
export function journalIds({ dialect }: SqlQuerier, tableName: string): { table: QueryRaw; name: QueryRaw } {
  return { table: raw.text(dialect.escapeId(tableName)), name: raw.text(dialect.escapeId('name')) };
}
