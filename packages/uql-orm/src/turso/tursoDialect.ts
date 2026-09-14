import { LibsqlDialect } from '../libsql/libsqlDialect.js';

/**
 * SQLite Dialect specialization for Turso Cloud: what every Turso Cloud database accepts, since one runs
 * libSQL unless it was created as `tursodb`, which runs the Rust engine. libSQL's vector functions and
 * argument cap hold on both, and so does the Rust engine's missing `ORDER BY` inside an aggregate.
 *
 * @remarks Imports nothing vendor-specific, so no entry point can pull a driver in through it.
 */
export class TursoDialect extends LibsqlDialect {
  /** The Rust engine takes no `ORDER BY` inside an aggregate. */
  protected override readonly orderedAggregates = false;
}
