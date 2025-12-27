import { AbstractQuerierPool } from 'nukak/querier';
import type { ExtraOptions } from 'nukak/type';
import pg from 'pg';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool extends AbstractQuerierPool<PgQuerier> {
  readonly pool: pg.Pool;

  constructor(opts: pg.PoolConfig, extra?: ExtraOptions) {
    super(extra);
    this.pool = new pg.Pool(opts);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
