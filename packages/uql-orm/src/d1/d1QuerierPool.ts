import { AbstractQuerierPool } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions } from '../type/index.js';
import { type D1Database, D1Querier } from './d1Querier.js';

export class D1QuerierPool extends AbstractQuerierPool<SqliteDialect, D1Querier> {
  constructor(
    readonly db: D1Database,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(extra?.namingStrategy), extra);
  }

  async getQuerier() {
    return new D1Querier(this.db, this.dialectInstance, this.extra);
  }

  async end() {
    // no-op for D1 bindings
  }
}
