import { createPool, Pool, PoolConnection } from 'mysql';
import { QuerierPool, QuerierPoolOptions, QuerierPoolConnection } from 'uql/type';
import { MySqlQuerier } from './mysqlQuerier';

export class MySqlQuerierPool implements QuerierPool<MySqlQuerier> {
  private readonly pool: Pool;

  constructor(opts: QuerierPoolOptions) {
    this.pool = createPool(opts);
  }

  getQuerier() {
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

  end() {
    return new Promise<void>((resolve, reject) => {
      this.pool.end((err) => {
        if (err) {
          return reject(err);
        }
        resolve();
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

export default MySqlQuerierPool;
