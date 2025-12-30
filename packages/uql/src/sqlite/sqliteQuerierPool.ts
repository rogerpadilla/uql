import type { Options } from 'better-sqlite3';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPool extends AbstractQuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(
    readonly filename?: string | Buffer,
    readonly opts?: Options,
    extra?: ExtraOptions,
  ) {
    super('sqlite', extra);
  }

  async getQuerier() {
    if (!this.querier) {
      let db: any;
      if (typeof Bun !== 'undefined') {
        const { Database } = await import('bun:sqlite');
        db = new Database(this.filename as string, this.opts as any);
        db.run('PRAGMA journal_mode = WAL');
      } else {
        const { default: Database } = await import('better-sqlite3');
        db = new Database(this.filename, this.opts);
        db.pragma('journal_mode = WAL');
      }
      this.querier = new SqliteQuerier(db, this.extra);
    }
    return this.querier;
  }

  async end() {
    await this.querier.db.close();
    delete this.querier;
  }
}
