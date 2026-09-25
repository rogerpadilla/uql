import { createPool, type Pool, type PoolConnection, type PoolOptions } from 'mysql2/promise';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { MySql2Querier } from './mysql2Querier.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2QuerierPool extends AbstractSqlQuerierPool<MySql2Querier, MySqlDialect> {
  readonly pool: Pool;
  readonly #utcSessions = new WeakSet<object>();

  constructor(opts: PoolOptions, extra?: ExtraOptions) {
    super(new MySqlDialect(dialectOptionsFrom(extra)), extra);
    // A BIGINT past 2^53 as its exact text rather than a rounded number, the rule every driver here
    // decodes by (`decodeWideNumber`); within that range it stays a number, and DECIMAL is untouched.
    // A date reads as the UTC it holds, whichever zone the process runs in.
    this.pool = createPool({ supportBigNumbers: true, timezone: 'Z', ...opts });
  }

  async getQuerier() {
    return new MySql2Querier(() => this.#connection(), this.dialect, this.extra);
  }

  /** A connection whose session is UTC too, so `NOW()` agrees with a bound date: set once per connection. */
  async #connection(): Promise<PoolConnection> {
    const connection = await this.pool.getConnection();
    if (this.#utcSessions.has(connection.connection)) {
      return connection;
    }
    try {
      await connection.query("SET time_zone = '+00:00'");
    } catch (error) {
      connection.release();
      throw error;
    }
    this.#utcSessions.add(connection.connection);
    return connection;
  }

  async end() {
    await this.pool.end();
  }
}
