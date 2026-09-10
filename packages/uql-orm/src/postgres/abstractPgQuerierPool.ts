import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler, type ErrorEmittingPool } from '../util/index.js';
import { type PgAnyClient, PgQuerier } from './pgQuerier.js';

export interface PgAnyPool<C extends PgAnyClient> extends ErrorEmittingPool {
  connect: () => Promise<C>;
  end: () => Promise<void>;
}

/**
 * Shared base class for Postgres-compatible querier pools. Each hands out a {@link PgQuerier} over its
 * driver's client, so a subclass supplies only the dialect and the driver's pool.
 *
 * Wires the crash-preventing error handler here, once, so a new pg-compatible pool subclass can't be
 * added without it - the constructor takes the already constructed pool and attaches the handler
 * unconditionally.
 */
export abstract class AbstractPgQuerierPool<
  C extends PgAnyClient,
  D extends AbstractSqlDialect,
> extends AbstractSqlQuerierPool<PgQuerier<C>, D> {
  constructor(
    dialect: D,
    readonly pool: PgAnyPool<C>,
    extra?: ExtraOptions,
  ) {
    super(dialect, extra);
    attachPoolErrorHandler(pool, 'Idle Postgres pool client encountered an error', extra?.logger);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
