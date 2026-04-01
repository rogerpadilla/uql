import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { type D1Database, D1Querier } from './d1Querier.js';
import { D1SqliteDialect } from './d1SqliteDialect.js';

export class D1QuerierPool extends AbstractQuerierPool<D1SqliteDialect, D1Querier> {
  readonly db: D1Database;

  constructor(db: D1Database, extra?: ExtraOptions) {
    super(new D1SqliteDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.db = db;
  }

  async getQuerier() {
    return new D1Querier(this.db, this.dialect, this.extra);
  }

  async end() {
    // no-op for D1 bindings
  }
}
