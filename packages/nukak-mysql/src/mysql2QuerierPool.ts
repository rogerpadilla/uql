import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import type { ExtraOptions } from 'nukak/type';
import { AbstractQuerierPool } from 'nukak/querier';
import { MySql2Querier } from './mysql2Querier.js';

export class MySql2QuerierPool extends AbstractQuerierPool<MySql2Querier> {
  readonly pool: Pool;

  constructor(opts: PoolOptions, extra?: ExtraOptions) {
    super(extra);
    this.pool = createPool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.getConnection();
    return new MySql2Querier(conn, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
