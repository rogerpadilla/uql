import { Pool, type PoolClient, type PoolConfig, types } from 'pg';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { ExtraOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { numericTypes } from './pgNumericTypes.js';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PoolClient, PostgresDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    // keepAlive reduces (but can't eliminate) idle connections being silently
    // dropped by NATs/firewalls on long-lived remote connections.
    super(
      new PostgresDialect(dialectOptionsFrom(extra)),
      new Pool({ keepAlive: true, types: numericTypes(types), ...opts }),
      extra,
    );
  }
}
