import { Pool, type PoolClient, type PoolConfig, types } from '@neondatabase/serverless';
import { AbstractPgQuerierPool } from '../postgres/abstractPgQuerierPool.js';
import { numericTypes } from '../postgres/pgNumericTypes.js';
import type { ExtraOptions } from '../type/index.js';
import { NeonDialect } from './neonDialect.js';
import { NeonQuerier } from './neonQuerier.js';

export class NeonQuerierPool extends AbstractPgQuerierPool<PoolClient, NeonQuerier, NeonDialect> {
  declare readonly pool: Pool;

  constructor(opts: PoolConfig, extra?: ExtraOptions) {
    // Neon's own `types`, not `pg`'s: this entry has to load on an edge runtime where `pg` is absent.
    super(
      new NeonDialect({ namingStrategy: extra?.namingStrategy }),
      new Pool({ types: numericTypes(types), ...opts }),
      extra,
    );
  }

  protected override buildQuerier(connect: () => Promise<PoolClient>) {
    return new NeonQuerier(connect, this.dialect, this.extra);
  }
}
