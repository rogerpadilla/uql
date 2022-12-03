import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { QuerierPool, ExtraOptions } from 'nukak/type/index.js';
import { MySql2Querier } from './mysql2Querier.js';

export class MySql2QuerierPool implements QuerierPool<MySql2Querier> {
  readonly pool: Pool;

  constructor(opts: PoolOptions, readonly extra?: ExtraOptions) {
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