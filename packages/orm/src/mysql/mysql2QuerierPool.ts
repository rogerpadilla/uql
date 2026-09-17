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
    this.pool = createPool({ supportBigNumbers: true, ...opts });
  }

  async getQuerier() {
    return new MySql2Querier(() => this.pool.getConnection(), this.dialect, this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
