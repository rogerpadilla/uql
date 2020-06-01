import { createPool, Pool, PoolConfig } from 'mariadb';
import { QuerierPool } from '../type';
import { MySqlQuerier } from './mysqlQuerier';

export default class MariadbQuerierPool implements QuerierPool {
  private readonly pool: Pool;

  constructor(protected readonly opts: PoolConfig) {
    this.pool = createPool(opts);
  }

  async getQuerier(): Promise<MySqlQuerier> {
    const conn = await this.pool.getConnection();
    return new MySqlQuerier(conn);
  }
}
