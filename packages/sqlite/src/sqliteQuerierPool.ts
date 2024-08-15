import Database, { Options } from 'better-sqlite3';
import type { ExtraOptions } from 'nukak/type';
import { AbstractQuerierPool } from 'nukak/querier';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPool extends AbstractQuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(
    readonly filename?: string | Buffer,
    readonly opts?: Options,
    extra?: ExtraOptions,
  ) {
    super(extra);
  }

  async getQuerier() {
    if (!this.querier) {
      const db = new Database(this.filename, this.opts);
      db.pragma('journal_mode = WAL');
      this.querier = new SqliteQuerier(db, this.extra);
    }
    return this.querier;
  }

  async end() {
    await this.querier.db.close();
    delete this.querier;
  }
}
