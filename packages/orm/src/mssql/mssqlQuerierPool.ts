import mssql, { type ConnectionPool, type config as MsSqlConfig } from 'mssql';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractDriverQuerierPool } from '../querier/index.js';
import type { DriverPoolOptions, LoggingOptions } from '../type/index.js';
import { attachPoolErrorHandler } from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { MsSqlDialect } from './mssqlDialect.js';
import { MsSqlQuerier } from './mssqlQuerier.js';

export class MsSqlQuerierPool extends AbstractDriverQuerierPool<MsSqlConfig, MsSqlPool, MsSqlQuerier, MsSqlDialect> {
  constructor(opts: MsSqlConfig, extra?: DriverPoolOptions<MsSqlConfig>) {
    super(new MsSqlDialect(dialectOptionsFrom(extra)), opts, extra, (config) => openPool(config, extra?.logger));
  }

  /** The primary's `mssql` pool. */
  get pool(): ConnectionPool {
    return this.primary.pool;
  }

  protected querierOn(pool: MsSqlPool) {
    return new MsSqlQuerier(() => pool.connect(), this.dialect, this.extra);
  }

  protected close(pool: MsSqlPool) {
    return pool.close();
  }
}

/**
 * A `mssql` pool and its one connect, shared by every querier on it. A failed connect is forgotten rather than handed
 * to every later caller; a closed pool refuses one, since `mssql` would reconnect it, and closes only once a connect
 * under way settles, which `mssql` refuses to close mid-connect.
 */
type MsSqlPool = {
  readonly pool: ConnectionPool;
  connect(): Promise<ConnectionPool>;
  close(): Promise<void>;
};

function openPool(config: MsSqlConfig, logger: LoggingOptions | undefined): MsSqlPool {
  const pool = new mssql.ConnectionPool(config);
  attachPoolErrorHandler(pool, 'Idle SQL Server pool connection encountered an error', logger);
  let connection: Promise<ConnectionPool> | 'ended' | undefined;
  return {
    pool,
    connect() {
      if (connection === 'ended') {
        return Promise.reject(new UqlUsageError('Cannot use a pool after calling end on it'));
      }
      if (connection) {
        return connection;
      }
      const connecting = pool.connect().catch((err: unknown) => {
        if (connection === connecting) {
          connection = undefined;
        }
        throw err;
      });
      connection = connecting;
      return connecting;
    },
    async close() {
      const connecting = connection;
      connection = 'ended';
      await Promise.allSettled([connecting]);
      await pool.close();
    },
  };
}
