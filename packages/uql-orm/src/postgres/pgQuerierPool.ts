import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { ExtraOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { PgQuerier } from './pgQuerier.js';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PoolClient, PostgresDialect, PgQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new PostgresDialect(extra?.namingStrategy), extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialectInstance, this.extra);
  }
}
