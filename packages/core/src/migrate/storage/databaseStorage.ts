import type { MigrationStorage, QuerierPool, SqlQuerier } from '../../type/index.js';
import { isSqlQuerier } from '../../type/index.js';

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
export class DatabaseMigrationStorage implements MigrationStorage {
  private readonly tableName: string;
  private storageInitialized = false;

  constructor(
    private readonly pool: QuerierPool,
    options: {
      tableName?: string;
    } = {},
  ) {
    this.tableName = options.tableName ?? 'uql_migrations';
  }

  async ensureStorage(): Promise<void> {
    if (this.storageInitialized) {
      return;
    }

    const querier = await this.pool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('DatabaseMigrationStorage requires a SQL-based querier');
    }

    try {
      await this.createTableIfNotExists(querier);
      this.storageInitialized = true;
    } finally {
      await querier.release();
    }
  }

  private async createTableIfNotExists(querier: SqlQuerier): Promise<void> {
    const { dialect } = querier;
    const sql = `
      CREATE TABLE IF NOT EXISTS ${dialect.escapeId(this.tableName)} (
        ${dialect.escapeId('name')} VARCHAR(255) PRIMARY KEY,
        ${dialect.escapeId('executed_at')} TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await querier.run(sql);
  }

  async executed(): Promise<string[]> {
    await this.ensureStorage();

    const querier = await this.pool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('DatabaseMigrationStorage requires a SQL-based querier');
    }

    try {
      const { dialect } = querier;
      const sql = `SELECT ${dialect.escapeId('name')} FROM ${dialect.escapeId(this.tableName)} ORDER BY ${dialect.escapeId('name')} ASC`;
      const results = await querier.all<MigrationRecord>(sql);
      return results.map((r: any) => r.name);
    } finally {
      await querier.release();
    }
  }

  /**
   * Log a migration as executed - uses provided querier (within transaction)
   */
  async logWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    const { dialect } = querier;
    const sql = `INSERT INTO ${dialect.escapeId(this.tableName)} (${dialect.escapeId('name')}) VALUES (${dialect.placeholder(1)})`;
    await querier.run(sql, [migrationName]);
  }

  /**
   * Unlog a migration - uses provided querier (within transaction)
   */
  async unlogWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    const { dialect } = querier;
    const sql = `DELETE FROM ${dialect.escapeId(this.tableName)} WHERE ${dialect.escapeId('name')} = ${dialect.placeholder(1)}`;
    await querier.run(sql, [migrationName]);
  }
}
