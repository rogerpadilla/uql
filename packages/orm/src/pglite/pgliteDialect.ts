import { POSTGRES_FEATURES, PostgresDialect } from '../postgres/postgresDialect.js';
import type { SqlDialectFeatures } from '../type/index.js';

/** Postgres as PGlite runs it, which binds fewer values per statement than a server. */
export class PgliteDialect extends PostgresDialect {
  /** Every querier shares the one session, which an advisory lock it already holds never makes wait. */
  override readonly features: SqlDialectFeatures = { ...POSTGRES_FEATURES, namedLocks: false };

  /** Past 32767 PGlite answers no rows, and wrong ones from then on, where a server takes 65535. */
  override readonly maxBindValues: number = 32767;
}
