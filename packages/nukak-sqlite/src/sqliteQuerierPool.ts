import { type ISqlite, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { ExtraOptions, QuerierPool } from 'nukak/type/index.js';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(readonly opts: Omit<ISqlite.Config, 'driver'>, readonly extra?: ExtraOptions) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ ...this.opts, driver: Sqlite3Driver });
      this.querier = new SqliteQuerier(db, this.extra);
    }
    return this.querier;
  }

  async end() {
    await this.querier.end();
    delete this.querier;
  }
}
