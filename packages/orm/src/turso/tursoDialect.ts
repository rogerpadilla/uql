import { LIBSQL_FEATURES, LibsqlDialect } from '../libsql/libsqlDialect.js';
import type { SqlDialectFeatures } from '../type/index.js';

/**
 * Turso Cloud, as every database there accepts: libSQL's, and the Rust engine's of one created as
 * `tursodb`. Imports no driver.
 */
export class TursoDialect extends LibsqlDialect {
  /** The Rust engine cannot read the table a write changes from inside a subquery. */
  override readonly features: SqlDialectFeatures = { ...LIBSQL_FEATURES, correlatedWrites: false };
}
