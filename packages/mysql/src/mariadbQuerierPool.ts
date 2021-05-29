import { createPool, Pool, PoolConfig } from 'mariadb';
import { QuerierPool } from '@uql/core/type';
import { MariadbQuerier } from './mariadbQuerier';
import { MariadbConnection } from './mariadbConnection';

export class MariadbQuerierPool implements QuerierPool<MariadbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new MariadbQuerier(new MariadbConnection(conn));
  }

  async end() {
    await this.pool.end();
  }
}
