import { createPool, Pool, PoolConfig } from 'mariadb';
import { QuerierPool } from '../../type';
import { MariadbQuerier } from './mariadbQuerier';

export class MariadbQuerierPool implements QuerierPool<MariadbQuerier> {
  private readonly pool: Pool;

  constructor(opts: PoolConfig) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new MariadbQuerier(conn);
  }

  end() {
    return this.pool.end();
  }
}

export default MariadbQuerierPool;
