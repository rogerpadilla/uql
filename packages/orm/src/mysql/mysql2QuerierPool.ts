import { promisify } from 'node:util';
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { MySql2Querier } from './mysql2Querier.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2QuerierPool extends AbstractSqlQuerierPool<MySql2Querier, MySqlDialect> {
  readonly pool: Pool;

  constructor(opts: PoolOptions, extra?: ExtraOptions) {
    super(new MySqlDialect(dialectOptionsFrom(extra)), extra);
    // A BIGINT past 2^53 as its exact text rather than a rounded number, the rule every driver here
    // decodes by (`decodeWideNumber`); within that range it stays a number, and DECIMAL is untouched.
    // A date reads as the UTC it holds, whichever zone the process runs in.
    this.pool = createPool({ supportBigNumbers: true, timezone: 'Z', ...opts });
    // The session in UTC too, so `NOW()` agrees with a bound date: queued as each connection opens, ahead of
    // any statement on it. One that fails has lost its connection, which the next statement reports.
    this.pool.pool.on('connection', (connection) => connection.query("SET time_zone = '+00:00'", () => {}));
  }

  async getQuerier() {
    const { pool } = this.pool;
    return new MySql2Querier(promisify(pool.getConnection.bind(pool)), this.dialect, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
