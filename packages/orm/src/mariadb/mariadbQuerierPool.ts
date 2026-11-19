import { createPool, type Pool, type SqlError } from 'mariadb';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractDriverQuerierPool } from '../querier/index.js';
import type { DriverPoolOptions, LoggingOptions } from '../type/index.js';
import { attachPoolErrorHandler } from '../util/index.js';
import { MariaDialect } from './mariaDialect.js';
import { MariadbQuerier } from './mariadbQuerier.js';

declare module 'mariadb' {
  /** The pool is an `EventEmitter` firing 'error' on a connection it cannot open or clean up, which its types leave out. */
  interface Pool {
    on(ev: 'error', callback: (err: SqlError) => void): Pool;
  }
}

type PoolConfig = Exclude<Parameters<typeof createPool>[0], string>;

export class MariadbQuerierPool extends AbstractDriverQuerierPool<PoolConfig, Pool, MariadbQuerier, MariaDialect> {
  constructor(opts: PoolConfig, extra?: DriverPoolOptions<PoolConfig>) {
    super(new MariaDialect(dialectOptionsFrom(extra)), opts, extra, (config) => openPool(config, extra?.logger));
  }

  /** The primary's `mariadb` pool. */
  get pool(): Pool {
    return this.primary;
  }

  protected querierOn(pool: Pool) {
    return new MariadbQuerier(() => pool.getConnection(), this.dialect, this.extra);
  }

  protected close(pool: Pool) {
    return pool.end();
  }
}

/**
 * BIGINT stays the driver's `bigint`, which `MariadbQuerier` decodes by the rule every driver here shares
 * (`decodeWideNumber`), not `bigIntAsNumber`, which rounds past 2^53 without a word. A date reads as its UTC text,
 * which hydration decodes, since the connector would take it for local time whatever `timezone` says; that only sets
 * the session's zone, UTC, so `NOW()` agrees.
 */
function openPool(config: PoolConfig, logger: LoggingOptions | undefined): Pool {
  const pool = createPool({ timezone: 'Z', dateStrings: true, ...config });
  attachPoolErrorHandler(pool, 'MariaDB pool connection encountered an error', logger);
  return pool;
}
