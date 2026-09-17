import { Pool, type PoolClient, type PoolConfig, types } from '@neondatabase/serverless';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import { numericTypes } from '../postgres/pgNumericTypes.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { ExtraOptions } from '../type/index.js';

export class NeonQuerierPool extends AbstractPgQuerierPool<PoolClient, PostgresDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    // Neon's own `types`, not `pg`'s: this entry has to load on an edge runtime where `pg` is absent.
    super(new PostgresDialect(dialectOptionsFrom(extra)), new Pool({ types: numericTypes(types), ...opts }), extra);
  }
}
