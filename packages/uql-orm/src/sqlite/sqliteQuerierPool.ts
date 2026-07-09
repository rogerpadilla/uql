import type { Database, Options } from 'better-sqlite3';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { BetterSqlite3Dialect } from './betterSqlite3Dialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPool extends AbstractSqlQuerierPool<SqliteQuerier, BetterSqlite3Dialect> {
  private db?: Database;

  constructor(
    readonly filename: string | Buffer = ':memory:',
    readonly opts?: Options,
    extra?: ExtraOptions,
  ) {
    super(new BetterSqlite3Dialect({ namingStrategy: extra?.namingStrategy }), extra);
  }

  /**
   * The database handle is shared (single connection), but each acquisition gets its own querier
   * so transaction state stays per unit of work.
   */
  async getQuerier() {
    this.db ??= await this.openDb();
    return new SqliteQuerier(this.db, this.dialect, this.extra);
  }

  private async openDb(): Promise<Database> {
    if (typeof Bun !== 'undefined') {
      const { Database: BunDatabase } = await import('bun:sqlite');
      const bunDb = new BunDatabase(this.filename as string, this.opts);
      bunDb.run('PRAGMA journal_mode = WAL');
      return bunDb as unknown as Database;
    }
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const db = new BetterSqlite3(this.filename, this.opts);
    db.pragma('journal_mode = WAL');
    return db;
  }

  async end() {
    await this.db?.close();
    this.db = undefined;
  }
}
