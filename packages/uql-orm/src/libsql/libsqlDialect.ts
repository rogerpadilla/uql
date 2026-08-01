import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { VectorDistance } from '../type/index.js';

/**
 * SQLite Dialect specialization for the `@libsql/client` driver.
 *
 * @remarks Distinct type for `LibsqlQuerierPool` and the home of the libSQL engine's built-in vector
 * functions, which `TursoDialect` inherits.
 */
export class LibsqlDialect extends SqliteDialect {
  /**
   * libSQL has vector search built in, under its own names, so the sqlite-vec `vec_distance_*`
   * functions this dialect would otherwise inherit are never present.
   *
   * @remarks `inner` and `l1` are left out: `vector_distance_dot` only exists in the newer Rust
   * engine (see `TursoDialect`) and no libSQL build has an L1 metric. Both raise the same
   * "does not support vector distance metric" error as any other unsupported metric.
   */
  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map([
    ['cosine', 'vector_distance_cos'],
    ['l2', 'vector_distance_l2'],
  ]);
}
