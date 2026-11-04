import { POSTGRES_FEATURES, PostgresDialect } from '../postgres/postgresDialect.js';
import type { SqlDialectFeatures } from '../type/index.js';

/** Postgres as PGlite runs it, one session shared by every querier. */
export class PgliteDialect extends PostgresDialect {
  /** Every querier shares the one session, which an advisory lock it already holds never makes wait. */
  override readonly features: SqlDialectFeatures = { ...POSTGRES_FEATURES, namedLocks: false };
}
