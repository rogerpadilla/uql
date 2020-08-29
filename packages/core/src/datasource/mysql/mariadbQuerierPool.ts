import { createPool, Pool, PoolConfig } from 'mariadb';
import { QuerierPool } from '../type';
import { MySqlQuerier } from './mysqlQuerier';

export default class MariadbQuerierPool implements QuerierPool<MySqlQuerier> {
  private readonly pool: Pool;

  constructor(opts: PoolConfig) {
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
