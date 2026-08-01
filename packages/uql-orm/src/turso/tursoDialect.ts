import { LibsqlDialect } from '../libsql/libsqlDialect.js';
import type { VectorDistance } from '../type/index.js';

/**
 * SQLite Dialect specialization for Turso Database.
 *
 * @remarks Shared by `TursoQuerierPool` (remote, `@tursodatabase/serverless`) and
 * `TursoLocalQuerierPool` (embedded, `@tursodatabase/database`). Built on `LibsqlDialect` because
 * Turso is that engine's successor and keeps its SQL surface, vector functions included. Imports
 * nothing vendor-specific, so the embedded entry point cannot pull native code into an edge bundle
 * through it.
 */
export class TursoDialect extends LibsqlDialect {
  /** The Rust engine adds a dot-product distance to libSQL's cosine and L2. */
  protected override readonly vectorDistanceFns: ReadonlyMap<VectorDistance, string> = new Map([
    ['cosine', 'vector_distance_cos'],
    ['l2', 'vector_distance_l2'],
    ['inner', 'vector_distance_dot'],
  ]);
}
