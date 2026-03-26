import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractQuerierPool } from '../querier/index.js';
import type { AbstractPgQuerier, PgAnyClient } from './abstractPgQuerier.js';

export interface PgAnyPool<C extends PgAnyClient> {
  connect: () => Promise<C>;
  end: () => Promise<void>;
}

/**
 * Shared base class for Postgres-compatible querier pools.
 */
export abstract class AbstractPgQuerierPool<
  C extends PgAnyClient,
  D extends AbstractSqlDialect,
  Q extends AbstractPgQuerier<C, D>,
> extends AbstractQuerierPool<D, Q> {
  abstract readonly pool: PgAnyPool<C>;

  async end() {
    await this.pool.end();
  }
}
