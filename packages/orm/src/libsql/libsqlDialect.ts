import { SQLITE_FEATURES, SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { SqlDialectFeatures, VectorDistance, VectorMetric } from '../type/index.js';

/** libSQL's server parses a statement before SQLite does, and its parser takes no `ORDER BY` inside an aggregate. */
export const LIBSQL_FEATURES: SqlDialectFeatures = { ...SQLITE_FEATURES, orderedJsonAggregates: false };

/**
 * SQLite Dialect specialization for the `@libsql/client` driver.
 *
 * @remarks Distinct type for `LibsqlQuerierPool` and the home of the libSQL engine's built-in vector
 * functions, which `TursoDialect` inherits.
 */
export class LibsqlDialect extends SqliteDialect {
  override readonly features: SqlDialectFeatures = LIBSQL_FEATURES;

  /** libSQL's built-in vector functions, and the metric its DiskANN index names; no `inner` (only the Rust engine has it) and no `l1`. */
  override readonly vectorMetrics: ReadonlyMap<VectorDistance, VectorMetric> = new Map([
    ['cosine', { fn: 'vector_distance_cos', index: 'cosine' }],
    ['l2', { fn: 'vector_distance_l2', index: 'l2' }],
  ]);
}
