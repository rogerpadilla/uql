import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { QuerierPool } from '../../type';
import { MySqlQuerier } from './mysqlQuerier';

export class MySql2QuerierPool implements QuerierPool<MySqlQuerier> {
  private readonly pool: Pool;

  constructor(opts: PoolOptions) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new MySqlQuerier(conn);
  }

  end() {
    return this.pool.end();
  }
}

export default MySql2QuerierPool;
