import { createPool, type Pool, type PoolConfig } from 'mariadb';
import { AbstractQuerierPool } from 'nukak/querier';
import type { ExtraOptions } from 'nukak/type';
import { MariadbQuerier } from './mariadbQuerier.js';

export class MariadbQuerierPool extends AbstractQuerierPool<MariadbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(extra);
    this.pool = createPool(opts);
  }

  async getQuerier() {
    return new MariadbQuerier(() => this.pool.getConnection(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
