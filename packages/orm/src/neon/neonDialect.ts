import { PostgresDialect } from '../postgres/postgresDialect.js';
import type { EngineName } from '../type/querier.js';

/** Postgres as Neon serves it: its proxy binds at most 32,767 values a statement over HTTP, half what Postgres takes. */
export class NeonDialect extends PostgresDialect {
  override get engineName(): EngineName {
    return 'Neon';
  }

  override readonly maxBindValues: number = 32_767;
}
