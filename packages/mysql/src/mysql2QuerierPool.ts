import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { QuerierPool } from '@uql/core/type';
import { SqlQuerier } from '@uql/core/querier';
import { MySqlDialect } from '@uql/core/dialect';
import { MySql2Connection } from './mysql2Connection';

export class MySql2QuerierPool implements QuerierPool<SqlQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolOptions) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new SqlQuerier(new MySql2Connection(conn), new MySqlDialect());
  }

  async end() {
    await this.pool.end();
  }
}
