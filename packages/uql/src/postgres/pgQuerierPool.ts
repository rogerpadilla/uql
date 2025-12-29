import pg from 'pg';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool extends AbstractQuerierPool<PgQuerier> {
  readonly pool: pg.Pool;

  constructor(opts: pg.PoolConfig, extra?: ExtraOptions) {
    super('postgres', extra);
    this.pool = new pg.Pool(opts);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
