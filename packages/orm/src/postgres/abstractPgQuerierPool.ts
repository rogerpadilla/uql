import { Pool, type PoolConfig, types } from 'pg';
import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractDriverQuerierPool } from '../querier/index.js';
import type { DriverPoolOptions, LoggingOptions } from '../type/index.js';
import { attachPoolErrorHandler } from '../util/index.js';
import { PgQuerier } from './pgQuerier.js';
import { wireTypes } from './pgWireTypes.js';

/** A `pg` pool of {@link PgQuerier}s, whose error handler keeps a dropped connection from crashing the process. */
export abstract class AbstractPgQuerierPool<D extends AbstractSqlDialect> extends AbstractDriverQuerierPool<
  PoolConfig,
  Pool,
  PgQuerier,
  D
> {
  constructor(dialect: D, opts: PoolConfig, extra?: DriverPoolOptions<PoolConfig>) {
    super(dialect, opts, extra, (config) => openPool(config, extra?.logger));
  }

  /** The primary's `pg` pool. */
  get pool(): Pool {
    return this.primary;
  }

  protected querierOn(pool: Pool) {
    return new PgQuerier(() => pool.connect(), this.dialect, this.extra);
  }

  protected close(pool: Pool) {
    return pool.end();
  }
}

/** keepAlive cuts down, but cannot stop, a NAT or firewall silently dropping an idle remote connection. */
function openPool(config: PoolConfig, logger: LoggingOptions | undefined): Pool {
  const pool = new Pool({ keepAlive: true, types: wireTypes(types), ...config });
  attachPoolErrorHandler(pool, 'Idle Postgres pool client encountered an error', logger);
  return pool;
}
