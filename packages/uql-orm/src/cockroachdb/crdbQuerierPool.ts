import { Pool, type PoolConfig } from 'pg';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { CrdbQuerier } from './crdbQuerier.js';

/**
 * QuerierPool for CockroachDB using the `pg` driver Pool.
 */
export class CrdbQuerierPool extends AbstractQuerierPool<CrdbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super('cockroachdb', extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new CrdbQuerier(() => this.pool.connect(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
