import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler, type ErrorEmittingPool } from '../util/index.js';
import { type PgAnyClient, PgQuerier } from './pgQuerier.js';

export interface PgAnyPool<C extends PgAnyClient> extends ErrorEmittingPool {
  connect: () => Promise<C>;
  end: () => Promise<void>;
}

/** A Postgres-wire pool of {@link PgQuerier}s, attaching the error handler that keeps a dropped connection from crashing the process. */
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
