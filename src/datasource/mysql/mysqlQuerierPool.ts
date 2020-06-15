import { createPool, Pool, PoolConnection } from 'mysql';
import { QuerierPool, QuerierPoolOptions, QuerierPoolConnection } from '../type';
import { MySqlQuerier } from './mysqlQuerier';

export default class MySqlQuerierPool implements QuerierPool {
  private readonly pool: Pool;

  constructor(protected readonly opts: QuerierPoolOptions) {
    this.pool = createPool(opts);
  }

  getQuerier(): Promise<MySqlQuerier> {
    return new Promise<MySqlQuerier>((resolve, reject) => {
      this.pool.getConnection((err, connection) => {
        if (err) {
          reject(err);
          return;
        }
        const conn = new MySqlConnectionPromisified(connection);
        const querier = new MySqlQuerier(conn);
        resolve(querier);
      });
    });
  }
}

class MySqlConnectionPromisified implements QuerierPoolConnection {
  constructor(private readonly conn: PoolConnection) {}

  query<T>(query: string) {
    return new Promise<T>((resolve, reject) => {
      this.conn.query(query, (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(([results] as unknown) as T);
      });
    });
  }

  release() {
    return this.conn.release();
  }
}
