import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { type D1Database, D1Querier } from './d1Querier.js';

export class D1QuerierPool extends AbstractQuerierPool<D1Querier> {
  constructor(
    readonly db: D1Database,
    extra?: ExtraOptions,
  ) {
    super('sqlite', extra);
  }

  async getQuerier() {
    return new D1Querier(this.db, this.extra);
  }

  async end() {
    // no-op for D1 bindings
  }
}
