import { Pool, type PoolClient, type PoolConfig, types } from 'pg';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import { numericTypes } from '../postgres/pgNumericTypes.js';
import type { ExtraOptions } from '../type/index.js';
import { CockroachDialect } from './cockroachDialect.js';

/**
 * QuerierPool for CockroachDB using the `pg` driver Pool.
 */
export class CrdbQuerierPool extends AbstractPgQuerierPool<PoolClient, CockroachDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(
      new CockroachDialect(dialectOptionsFrom(extra)),
      new Pool({ keepAlive: true, types: numericTypes(types), ...opts }),
      extra,
    );
  }
}
