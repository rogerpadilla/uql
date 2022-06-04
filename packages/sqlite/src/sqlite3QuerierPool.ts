import { ISqlite, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { QuerierLogger, QuerierPool } from '@uql/core/type';
import { SqliteQuerier } from './sqliteQuerier.js';

export class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(readonly opts: Omit<ISqlite.Config, 'driver'>, readonly logger?: QuerierLogger) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ ...this.opts, driver: Sqlite3Driver });
      this.querier = new SqliteQuerier(db, this.logger);
    }
    return this.querier;
  }

  async end() {
    await this.querier.end();
    delete this.querier;
  }
}
