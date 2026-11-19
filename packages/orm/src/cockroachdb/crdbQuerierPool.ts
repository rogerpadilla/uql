import type { PoolConfig } from 'pg';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import type { DriverPoolOptions } from '../type/index.js';
import { CockroachDialect } from './cockroachDialect.js';

/** QuerierPool for CockroachDB using the `pg` driver Pool. */
export class CrdbQuerierPool extends AbstractPgQuerierPool<CockroachDialect> {
  constructor(opts: PoolConfig, extra?: DriverPoolOptions<PoolConfig>) {
    super(new CockroachDialect(dialectOptionsFrom(extra)), opts, extra);
  }
}
