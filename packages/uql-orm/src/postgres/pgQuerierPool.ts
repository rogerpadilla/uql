import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { ExtraOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { PgDialect } from './pgDialect.js';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PoolClient, PgDialect, PgQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new PgDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }
}
