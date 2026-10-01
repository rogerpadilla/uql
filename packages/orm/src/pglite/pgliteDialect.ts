import { PostgresDialect } from '../postgres/postgresDialect.js';

/** Postgres as PGlite runs it, which binds fewer values per statement than a server. */
export class PgliteDialect extends PostgresDialect {
  /** Past 32767 PGlite answers no rows, and wrong ones from then on, where a server takes 65535. */
  override readonly maxBindValues: number = 32767;
}
