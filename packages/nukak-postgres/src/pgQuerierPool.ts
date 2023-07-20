import pg from 'pg';
import type { ExtraOptions, QuerierPool } from 'nukak/type';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool implements QuerierPool<PgQuerier> {
  readonly pool: pg.Pool;

  constructor(
    opts: pg.PoolConfig,
    readonly extra?: ExtraOptions,
  ) {
    this.pool = new pg.Pool(opts);
  }

  async getQuerier() {
    const conn = await this.pool.connect();
    return new PgQuerier(conn, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
