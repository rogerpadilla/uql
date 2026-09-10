import { ConnectionPool, type config as MsSqlConfig } from 'mssql';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { MsSqlDialect } from './mssqlDialect.js';
import { MsSqlQuerier } from './mssqlQuerier.js';

export class MsSqlQuerierPool extends AbstractSqlQuerierPool<MsSqlQuerier, MsSqlDialect> {
  readonly pool: ConnectionPool;
  #connected?: Promise<ConnectionPool>;

  constructor(opts: MsSqlConfig, extra?: ExtraOptions) {
    super(new MsSqlDialect(dialectOptionsFrom(extra)), extra);
    this.pool = new ConnectionPool(opts);
  }

  /**
   * `mssql` connects the pool as a whole rather than per checkout, so the promise is shared. A
   * failed one is dropped rather than kept: memoized, a single transient failure would be handed to
   * every later caller for the life of the pool.
   */
  async getQuerier() {
    return new MsSqlQuerier(() => this.#connect(), this.dialect, this.extra);
  }

  #connect(): Promise<ConnectionPool> {
    this.#connected ??= this.pool.connect().catch((err: unknown) => {
      this.#connected = undefined;
      throw err;
    });
    return this.#connected;
  }

  async end() {
    this.#connected = undefined;
    await this.pool.close();
  }
}
