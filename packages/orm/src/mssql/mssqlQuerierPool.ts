import mssql, { type ConnectionPool, type config as MsSqlConfig } from 'mssql';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { attachPoolErrorHandler } from '../util/index.js';
import { UqlUsageError } from '../util/uqlError.js';
import { MsSqlDialect } from './mssqlDialect.js';
import { MsSqlQuerier } from './mssqlQuerier.js';

export class MsSqlQuerierPool extends AbstractSqlQuerierPool<MsSqlQuerier, MsSqlDialect> {
  readonly pool: ConnectionPool;
  /** The whole pool's one connect, shared by every querier; `ended` once closed, since `mssql` would reconnect it. */
  #connection?: Promise<ConnectionPool> | 'ended';

  constructor(opts: MsSqlConfig, extra?: ExtraOptions) {
    super(new MsSqlDialect(dialectOptionsFrom(extra)), extra);
    this.pool = new mssql.ConnectionPool(opts);
    attachPoolErrorHandler(this.pool, 'Idle SQL Server pool connection encountered an error', extra?.logger);
  }

  async getQuerier() {
    return new MsSqlQuerier(() => this.#connect(), this.dialect, this.extra);
  }

  /** A failed connect is forgotten rather than handed to every later caller, unless `end` came first. */
  #connect(): Promise<ConnectionPool> {
    const current = this.#connection;
    if (current) {
      if (current === 'ended') {
        return Promise.reject(new UqlUsageError('Cannot use a pool after calling end on it'));
      }
      return current;
    }
    const connecting = this.pool.connect().catch((err: unknown) => {
      if (this.#connection === connecting) {
        this.#connection = undefined;
      }
      throw err;
    });
    this.#connection = connecting;
    return connecting;
  }

  /** `mssql` refuses to close a pool mid-connect, so the connect under way settles first. */
  async end() {
    const connecting = this.#connection;
    this.#connection = 'ended';
    await Promise.allSettled([connecting]);
    await this.pool.close();
  }
}
