import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { ExtraOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { PgDialect } from './pgDialect.js';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PoolClient, PgQuerier, PgDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    // keepAlive reduces (but can't eliminate) idle connections being silently
    // dropped by NATs/firewalls on long-lived remote connections.
    super(new PgDialect({ namingStrategy: extra?.namingStrategy }), new Pool({ keepAlive: true, ...opts }), extra);
  }

  async getQuerier() {
    return new PgQuerier(() => this.pool.connect(), this.dialect, this.extra);
  }
}
