import { Database, open } from 'sqlite';
import { Database as Sqlite3Driver } from 'sqlite3';
import { QuerierPool } from '../type';
import { SqliteQuerier } from './sqliteQuerier';

export default class Sqlite3QuerierPool implements QuerierPool<SqliteQuerier> {
  private db: Database;

  constructor(readonly filename: string) {}

  async getQuerier() {
    if (!this.db) {
      this.db = await open({ filename: this.filename, driver: Sqlite3Driver });
    }
    const querier = new SqliteQuerier(this.db);
    return Promise.resolve(querier);
  }

  async end() {
    await this.db.close();
    this.db = undefined;
  }
}
