import { LibsqlDialect } from '../libsql/libsqlDialect.js';
import { SQLITE_FEATURES } from '../sqlite/sqliteDialect.js';
import type { SqlDialectFeatures } from '../type/index.js';

/**
 * Turso Cloud, as every database there accepts: libSQL's vector functions and argument cap, and no
 * `ORDER BY` inside an aggregate, which its Rust engine lacks. Imports no driver.
 */
export class TursoDialect extends LibsqlDialect {
  /** The Rust engine takes no `ORDER BY` inside an aggregate, nor a subquery reading the table a write changes. */
  override readonly features: SqlDialectFeatures = {
    ...SQLITE_FEATURES,
    orderedJsonAggregates: false,
    correlatedWrites: false,
  };
}
