import { open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { QuerierPool, QuerierPoolSqlite3Options } from '@uql/core/type';
import { SqliteQuerier } from './sqliteQuerier';
import { Sqlit3Connection } from './sqlite3Connection';

export class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(readonly opts: QuerierPoolSqlite3Options) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ filename: this.opts.filename, driver: Sqlite3Driver });
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
