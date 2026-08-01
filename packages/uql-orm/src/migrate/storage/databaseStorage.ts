import type { MigrationStorage, QuerierPool, SqlQuerier } from '../../type/index.js';
import { withSqlQuerierForMigrations } from '../acquireQuerierForMigrations.js';

/**
 * Migration metadata stored in the database
 */
interface MigrationRecord {
  name: string;
  executed_at: Date | number;
}

/**
 * Stores migration state in a database table.
 * Uses the querier's dialect for escaping and placeholders.
 */
/** Where executed migrations are recorded when the config does not name a table. */
export const DEFAULT_MIGRATIONS_TABLE = 'uql_migrations';

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

  async ensureStorage(): Promise<void> {
    if (this.storageInitialized) {
      return;
    }

    await withSqlQuerierForMigrations(this.pool, 'DatabaseMigrationStorage', async (querier) => {
      await this.createTableIfNotExists(querier);
      this.storageInitialized = true;
    });
  }

  private async createTableIfNotExists(querier: SqlQuerier): Promise<void> {
    const { dialect } = querier;
    const sql = /*sql*/ `
      CREATE TABLE IF NOT EXISTS ${dialect.escapeId(this.tableName)} (
        ${dialect.escapeId('name')} VARCHAR(255) PRIMARY KEY,
        ${dialect.escapeId('executed_at')} TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await querier.run(sql);
  }

  async executed(): Promise<string[]> {
    await this.ensureStorage();

    return withSqlQuerierForMigrations(this.pool, 'DatabaseMigrationStorage', async (querier) => {
      const { dialect } = querier;
      const sql = /*sql*/ `SELECT ${dialect.escapeId('name')} FROM ${dialect.escapeId(this.tableName)} ORDER BY ${dialect.escapeId('name')} ASC`;
      const results = await querier.all<MigrationRecord>(sql);
      return results.map((r) => r.name);
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
