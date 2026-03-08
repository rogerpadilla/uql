import { createPool, type Pool } from 'mariadb';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { MariadbQuerier } from './mariadbQuerier.js';

type PoolConfig = Exclude<Parameters<typeof createPool>[0], string>;

export class MariadbQuerierPool extends AbstractQuerierPool<MariadbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super('mariadb', extra);
    this.pool = createPool(opts);
  }

  async getQuerier() {
    return new MariadbQuerier(() => this.pool.getConnection(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
