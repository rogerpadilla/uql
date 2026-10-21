import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler } from '../util/index.js';
import { type PgAnyClient, PgQuerier } from './pgQuerier.js';

export interface PgAnyPool {
  connect: () => Promise<PgAnyClient>;
  end: () => Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/** A Postgres-wire pool of {@link PgQuerier}s, attaching the error handler that keeps a dropped connection from crashing the process. */
export abstract class AbstractPgQuerierPool<D extends AbstractSqlDialect> extends AbstractSqlQuerierPool<PgQuerier, D> {
  constructor(
    dialect: D,
    readonly pool: PgAnyPool,
    extra?: ExtraOptions,
  ) {
    super(dialect, extra);
    attachPoolErrorHandler(pool, 'Idle Postgres pool client encountered an error', extra?.logger);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }

  override async end() {
    await this.pool.end();
  }
}
