import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler, type ErrorEmittingPool } from '../util/index.js';
import type { AbstractPgQuerier, PgAnyClient } from './abstractPgQuerier.js';

export interface PgAnyPool<C extends PgAnyClient> extends ErrorEmittingPool {
  connect: () => Promise<C>;
  end: () => Promise<void>;
}

/**
 * Shared base class for Postgres-compatible querier pools.
 *
 * Wires the crash-preventing error handler here, once, so a new pg-compatible
 * pool subclass can't be added without it - the constructor takes the already
 * constructed pool and attaches the handler unconditionally.
 */
export abstract class AbstractPgQuerierPool<
  C extends PgAnyClient,
  Q extends AbstractPgQuerier<C, D>,
  D extends AbstractSqlDialect,
> extends AbstractSqlQuerierPool<Q, D> {
  constructor(
    dialect: D,
    readonly pool: PgAnyPool<C>,
    extra?: ExtraOptions,
  ) {
    super(dialect, extra);
    attachPoolErrorHandler(pool, 'Idle Postgres pool client encountered an error');
  }

  async end() {
    await this.pool.end();
  }
}
