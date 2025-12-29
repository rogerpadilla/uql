import type { QuerierPool, SqlQuerier } from 'nukak/type';
import { isSqlQuerier } from 'nukak/type';
import type { MigrationStorage } from '../type.js';

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
    private readonly querierPool: QuerierPool,
    options: {
      tableName?: string;
    } = {},
  ) {
    this.tableName = options.tableName ?? 'nukak_migrations';
  }

  async ensureStorage(): Promise<void> {
    if (this.storageInitialized) {
      return;
    }

    const querier = await this.querierPool.getQuerier();

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
    const { escapeId } = querier.dialect;
    const sql = `
      CREATE TABLE IF NOT EXISTS ${escapeId(this.tableName)} (
        ${escapeId('name')} VARCHAR(255) PRIMARY KEY,
        ${escapeId('executed_at')} TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await querier.run(sql);
  }

  async executed(): Promise<string[]> {
    await this.ensureStorage();

    const querier = await this.querierPool.getQuerier();

    if (!isSqlQuerier(querier)) {
      await querier.release();
      throw new Error('DatabaseMigrationStorage requires a SQL-based querier');
    }

    try {
      const { escapeId } = querier.dialect;
      const sql = `SELECT ${escapeId('name')} FROM ${escapeId(this.tableName)} ORDER BY ${escapeId('name')} ASC`;
      const results = await querier.all<MigrationRecord>(sql);
      return results.map((r) => r.name);
    } finally {
      await querier.release();
    }
  }

  /**
   * Log a migration as executed - uses provided querier (within transaction)
   */
  async logWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    const { escapeId, placeholder } = querier.dialect;
    const sql = `INSERT INTO ${escapeId(this.tableName)} (${escapeId('name')}) VALUES (${placeholder(1)})`;
    await querier.run(sql, [migrationName]);
  }

  /**
   * Unlog a migration - uses provided querier (within transaction)
   */
  async unlogWithQuerier(querier: SqlQuerier, migrationName: string): Promise<void> {
    await this.ensureStorage();
    const { escapeId, placeholder } = querier.dialect;
    const sql = `DELETE FROM ${escapeId(this.tableName)} WHERE ${escapeId('name')} = ${placeholder(1)}`;
    await querier.run(sql, [migrationName]);
  }
}
