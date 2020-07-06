import { Database, sqlite3 } from 'sqlite3';
import { QuerierPool, QuerierPoolConnection } from '../type';
import { SqliteQuerier } from './sqliteQuerier';

export default class Sqlite3QuerierPool implements QuerierPool {
  private readonly db: Database;

  constructor(filename: string) {
    this.db = new Database(filename);
  }

  getQuerier(): Promise<SqliteQuerier> {
    const conn = new SqliteConnectionPromisified(this.db);
    const querier = new SqliteQuerier(conn);
    return Promise.resolve(querier);
  }

  end(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

class SqliteConnectionPromisified implements QuerierPoolConnection {
  constructor(private readonly db: Database) {}

  query<T>(query: string) {
    return new Promise<T>((resolve, reject) => {
      this.db.all(query, (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(({ rows: results } as unknown) as T);
      });
    });
  }

  release() {
    // NOP
  }
}
