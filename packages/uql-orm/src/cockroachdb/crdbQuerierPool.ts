import { Pool, type PoolClient, type PoolConfig, types } from 'pg';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import { numericTypes } from '../postgres/pgNumericTypes.js';
import type { ExtraOptions } from '../type/index.js';
import { CockroachDialect } from './cockroachDialect.js';
import { CrdbQuerier } from './crdbQuerier.js';

/**
 * QuerierPool for CockroachDB using the `pg` driver Pool.
 */
export class CrdbQuerierPool extends AbstractPgQuerierPool<PoolClient, CrdbQuerier, CockroachDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(
      new CockroachDialect({ namingStrategy: extra?.namingStrategy }),
      new Pool({ keepAlive: true, types: numericTypes(types), ...opts }),
      extra,
    );
  }

  protected override buildQuerier(connect: () => Promise<PoolClient>) {
    return new CrdbQuerier(connect, this.dialect, this.extra);
  }
}
