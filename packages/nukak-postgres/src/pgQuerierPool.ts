import pg from 'pg';
import type { ExtraOptions } from 'nukak/type';
import { AbstractQuerierPool } from 'nukak/querier';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool extends AbstractQuerierPool<PgQuerier> {
  readonly pool: pg.Pool;

  constructor(opts: pg.PoolConfig, extra?: ExtraOptions) {
    super(extra);
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
