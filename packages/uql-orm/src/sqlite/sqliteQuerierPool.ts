import type { Database, Options } from 'better-sqlite3';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPool extends AbstractQuerierPool<SqliteDialect, SqliteQuerier> {
  private querier?: SqliteQuerier;

  constructor(
    readonly filename?: string | Buffer,
    readonly opts?: Options,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(extra?.namingStrategy), extra);
  }

  async getQuerier() {
    if (!this.querier) {
      let db: Database;
      if (typeof Bun !== 'undefined') {
        const { Database: BunDatabase } = await import('bun:sqlite');
        const bunDb = new BunDatabase(this.filename as string, this.opts);
        bunDb.run('PRAGMA journal_mode = WAL');
        db = bunDb as unknown as Database;
      } else {
        const { default: BetterSqlite3 } = await import('better-sqlite3');
        db = new BetterSqlite3(this.filename, this.opts);
        db.pragma('journal_mode = WAL');
      }
      this.querier = new SqliteQuerier(db, this.dialectInstance, this.extra);
    }
    return this.querier;
  }

  async end() {
    await this.querier?.db.close();
    this.querier = undefined;
  }
}
