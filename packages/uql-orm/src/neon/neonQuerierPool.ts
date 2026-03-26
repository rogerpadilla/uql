import { Pool, type PoolClient, type PoolConfig } from '@neondatabase/serverless';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import { PostgresDialect } from '../postgres/index.js';
import type { ExtraOptions } from '../type/index.js';
import { NeonQuerier } from './neonQuerier.js';

export class NeonQuerierPool extends AbstractPgQuerierPool<PoolClient, PostgresDialect, NeonQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new PostgresDialect(extra?.namingStrategy), extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new NeonQuerier(() => this.pool.connect(), this.dialectInstance, this.extra);
  }
}
