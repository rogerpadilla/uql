import { Pool, type PoolClient, type PoolConfig } from '@neondatabase/serverless';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { NeonDialect } from './neonDialect.js';
import { NeonQuerier } from './neonQuerier.js';

export class NeonQuerierPool extends AbstractPgQuerierPool<PoolClient, NeonDialect, NeonQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super(new NeonDialect({ namingStrategy: extra?.namingStrategy }), extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new NeonQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }
}
