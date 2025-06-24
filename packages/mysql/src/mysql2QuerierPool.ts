import { createPool, type Pool, type PoolOptions } from 'mysql2/promise';
import { AbstractQuerierPool } from 'nukak/querier';
import type { ExtraOptions } from 'nukak/type';
import { MySql2Querier } from './mysql2Querier.js';

export class MySql2QuerierPool extends AbstractQuerierPool<MySql2Querier> {
  readonly pool: Pool;

  constructor(opts: PoolOptions, extra?: ExtraOptions) {
    super(extra);
    this.pool = createPool(opts);
  }

  async getQuerier() {
    return new MySql2Querier(() => this.pool.getConnection(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
