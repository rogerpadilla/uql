import { Database, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { QuerierPool, QuerierPoolConnection } from '../../type';
import { SqliteQuerier } from './sqliteQuerier';

export class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private querier: SqliteQuerier;

  constructor(readonly filename: string) {}

  async getQuerier() {
    if (!this.querier) {
      const db = await open({ filename: this.filename, driver: Sqlite3Driver });
      const conn = new Sqlit3Connection(db);
      this.querier = new SqliteQuerier(conn);
    }
    return this.querier;
  }

  async end() {
    await this.querier.conn.db.close();
    delete this.querier;
  }
}

export class Sqlit3Connection implements QuerierPoolConnection {
  constructor(readonly db: Database) {}

  query(query: string) {
    // console.debug(query);
    return this.db.run(query);
  }

  all(query: string) {
    // console.debug(query);
    return this.db.all(query);
  }

  release() {
    // no-op
  }
}

export default Sqlite3QuerierPool;
