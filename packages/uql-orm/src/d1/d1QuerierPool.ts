import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { type D1Preparer, D1Querier } from './d1Querier.js';
import { D1SqliteDialect } from './d1SqliteDialect.js';

/**
 * Pool for Cloudflare D1. It holds nothing: every querier runs on what it was given, `env.DB` or a
 * session from `env.DB.withSession()`, the way a read-replicated database is read consistently.
 */
export class D1QuerierPool extends AbstractSqlQuerierPool<D1Querier, D1SqliteDialect> {
  constructor(
    readonly db: D1Preparer,
    extra?: ExtraOptions,
  ) {
    super(new D1SqliteDialect(dialectOptionsFrom(extra)), extra);
  }

  async getQuerier() {
    return new D1Querier(this.db, this.dialect, this.extra);
  }

  async end() {}
}
