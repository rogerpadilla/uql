import { createPool, Pool, PoolConfig } from 'mariadb';
import { QuerierLogger, QuerierPool } from '@uql/core/type';
import { MariadbQuerier } from './mariadbQuerier.js';

export class MariadbQuerierPool implements QuerierPool<MariadbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, readonly logger?: QuerierLogger) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new MariadbQuerier(conn, this.logger);
  }

  async end() {
    await this.pool.end();
  }
}
