import { Pool, type PoolClient, type PoolConfig, types } from 'pg';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { ExtraOptions } from '../type/index.js';
import { AbstractPgQuerierPool } from './abstractPgQuerierPool.js';
import { PgDialect } from './pgDialect.js';
import { numericTypes } from './pgNumericTypes.js';
import { PgQuerier } from './pgQuerier.js';

export class PgQuerierPool extends AbstractPgQuerierPool<PoolClient, PgQuerier, PgDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    // keepAlive reduces (but can't eliminate) idle connections being silently
    // dropped by NATs/firewalls on long-lived remote connections.
    super(
      new PgDialect(dialectOptionsFrom(extra)),
      new Pool({ keepAlive: true, types: numericTypes(types), ...opts }),
      extra,
    );
  }

  protected override buildQuerier(connect: () => Promise<PoolClient>) {
    return new PgQuerier(connect, this.dialect, this.extra);
  }
}
