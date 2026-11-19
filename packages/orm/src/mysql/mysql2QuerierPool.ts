import { promisify } from 'node:util';
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractDriverQuerierPool } from '../querier/index.js';
import type { DriverPoolOptions } from '../type/index.js';
import { noop } from '../util/object.util.js';
import { MySql2Querier } from './mysql2Querier.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2QuerierPool extends AbstractDriverQuerierPool<PoolOptions, Pool, MySql2Querier, MySqlDialect> {
  constructor(opts: PoolOptions, extra?: DriverPoolOptions<PoolOptions>) {
    super(new MySqlDialect(dialectOptionsFrom(extra)), opts, extra, openPool);
  }

  /** The primary's `mysql2` pool. */
  get pool(): Pool {
    return this.primary;
  }

  protected querierOn({ pool }: Pool) {
    return new MySql2Querier(promisify(pool.getConnection.bind(pool)), this.dialect, this.extra);
  }

  protected close(pool: Pool) {
    return pool.end();
  }
}

function openPool(config: PoolOptions): Pool {
  // A BIGINT past 2^53 as its exact text rather than a rounded number, the rule every driver here
  // decodes by (`decodeWideNumber`); within that range it stays a number, and DECIMAL is untouched.
  // A date reads as the UTC it holds, whichever zone the process runs in.
  const pool = createPool({ supportBigNumbers: true, timezone: 'Z', ...config });
  // The session in UTC too, so `NOW()` agrees with a bound date: queued as each connection opens, ahead of
  // any statement on it. One that fails has lost its connection, which the next statement reports.
  pool.pool.on('connection', (connection) => connection.query("SET time_zone = '+00:00'", noop));
  return pool;
}
