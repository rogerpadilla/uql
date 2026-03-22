import { Pool, type PoolConfig } from '@neondatabase/serverless';
import { AbstractQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { NeonQuerier } from './neonQuerier.js';

export class NeonQuerierPool extends AbstractQuerierPool<NeonQuerier> {
  readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    super('postgres', extra);
    this.pool = new Pool(opts);
  }

  async getQuerier() {
    return new NeonQuerier(() => this.pool.connect(), this.extra);
  }

  async end() {
    await this.pool.end();
  }
}
