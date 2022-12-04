import { createPool, Pool, PoolConfig } from 'mariadb';
import type { ExtraOptions, QuerierPool } from 'nukak/type';
import { MariadbQuerier } from './mariadbQuerier.js';

export class MariadbQuerierPool implements QuerierPool<MariadbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, readonly extra?: ExtraOptions) {
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new MariadbQuerier(conn, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
