import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { CockroachDialect } from './cockroachDialect.js';
import { CrdbQuerier } from './crdbQuerier.js';

/**
 * QuerierPool for CockroachDB using the `pg` driver Pool.
 */
export class CrdbQuerierPool extends AbstractPgQuerierPool<PoolClient, CockroachDialect, CrdbQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new CockroachDialect(extra?.namingStrategy), extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new CrdbQuerier(() => this.pool.connect(), this.dialectInstance, this.extra);
  }
}
