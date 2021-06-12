import { ISqlite, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { QuerierPool } from '@uql/core/type';
import { SqliteQuerier } from './sqliteQuerier';
import { Sqlit3Connection } from './sqlite3Connection';

export class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(readonly config: Omit<ISqlite.Config, 'driver'>) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ ...this.config, driver: Sqlite3Driver });
      const conn = new Sqlit3Connection(db);
      this.querier = new SqliteQuerier(conn);
    }
    return this.querier;
  }

  async end() {
    await this.querier.conn.end();
    delete this.querier;
  }
}
