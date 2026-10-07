import type { MigrationStorage, QuerierPool, SqlQuerier } from '../../type/index.js';
import { currentTimestamp } from '../../util/raw.js';
import { withSqlQuerierForMigrations } from '../acquireQuerierForMigrations.js';
import { TableBuilder } from '../builder/tableBuilder.js';
import { SqlSchemaGenerator } from '../schemaGenerator.js';

/** Where executed migrations are recorded when the config does not name a table. */
export const DEFAULT_MIGRATIONS_TABLE = 'uql_migrations';

/**
 * Stores migration state in a database table.
 * Uses the querier's dialect for escaping and placeholders.
 */
export class DatabaseMigrationStorage implements MigrationStorage {
  private readonly tableName: string;
  private storageInitialized = false;

  constructor(
    private readonly pool: QuerierPool,
    options: {
      tableName?: string;
    } = {},
  ) {
    this.tableName = options.tableName ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /** Creates the table on first use, once. */
  private async ensureStorage(): Promise<void> {
    if (this.storageInitialized) {
      return;
    }

    await withSqlQuerierForMigrations(this.pool, 'DatabaseMigrationStorage', async (querier) => {
      await this.createTableIfNotExists(querier);
      this.storageInitialized = true;
    });
  }

  /**
   * Rendered by the schema generator rather than written out, so each engine gets its own spelling: SQL
   * Server has no `CREATE TABLE IF NOT EXISTS`, and its `TIMESTAMP` is a row version that takes no default.
   */
  private async createTableIfNotExists(querier: SqlQuerier): Promise<void> {
    const table = new TableBuilder(this.tableName);
    table.string('name', { length: 255, primaryKey: true });
    table.timestamptz('executed_at', { defaultValue: currentTimestamp });
    const generator = new SqlSchemaGenerator(querier.dialect);
    for (const sql of generator.generateCreateTableFromDefinition(table.build(), { ifNotExists: true })) {
      await querier.run(sql);
    }
  }

  async executed(): Promise<string[]> {
    await this.ensureStorage();

    return withSqlQuerierForMigrations(this.pool, 'DatabaseMigrationStorage', async (querier) => {
      const { dialect } = querier;
      const sql = /*sql*/ `SELECT ${dialect.escapeId('name')} FROM ${dialect.escapeId(this.tableName)} ORDER BY ${dialect.escapeId('name')} ASC`;
      const rows = await querier.all<{ name: string }>(sql);
      return rows.map((row) => row.name);
    });
  }

  /**
   * Log a migration as executed - uses provided querier (within transaction)
   */
  async logWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    const { dialect } = querier;
    const sql = /*sql*/ `INSERT INTO ${dialect.escapeId(this.tableName)} (${dialect.escapeId('name')}) VALUES (${dialect.placeholder(1)})`;
    await querier.run(sql, [migrationName]);
  }

  /**
   * Unlog a migration - uses provided querier (within transaction)
   */
  async unlogWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    const { dialect } = querier;
    const sql = /*sql*/ `DELETE FROM ${dialect.escapeId(this.tableName)} WHERE ${dialect.escapeId('name')} = ${dialect.placeholder(1)}`;
    await querier.run(sql, [migrationName]);
  }
}
