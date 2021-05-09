import { Database, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { QuerierPool, QuerierPoolConnection, QuerierPoolSqlite3Options } from '../../type';
import { SqliteQuerier } from './sqliteQuerier';

export class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(private readonly opts: QuerierPoolSqlite3Options) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ filename: this.opts.filename, driver: Sqlite3Driver });
      const conn = new Sqlit3Connection(db);
      this.querier = new SqliteQuerier(conn);
    }
    return this.querier;
  }

  async end() {
    await this.querier.conn.close();
    delete this.querier;
  }
}

export class Sqlit3Connection implements QuerierPoolConnection {
  constructor(private readonly db: Database) {}

  query(query: string) {
    // console.debug(query);
    return this.db.all(query);
  }

  run(query: string) {
    // console.debug(query);
    return this.db.run(query);
  }

  release() {
    // no-op
  }

  async close() {
    await this.db.close();
  }
}

export default Sqlite3QuerierPool;
