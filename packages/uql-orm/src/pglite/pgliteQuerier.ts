import { AbstractSqlQuerier } from '../querier/index.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import type { PgliteDialect } from './pgliteDialect.js';

/**
 * Structural subset of the `@electric-sql/pglite` API actually used here, declared locally so this
 * package does not couple its published types to a pre-1.0 dependency.
 *
 * @remarks This is what uql *consumes* from the driver, so it is two methods and stating them costs
 * nothing. `PglitePoolOptions` is the opposite case and imports PGlite's own type: those options are
 * the caller's input to the driver, so restating them would mean re-deriving its whole option surface
 * and then casting at the `PGlite.create` call.
 */
export type PgliteDatabase = {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  close(): Promise<void>;
};

/**
 * Querier for PGlite, Postgres compiled to WASM and run in this process.
 *
 * @remarks Extends {@link AbstractSqlQuerier} rather than `AbstractPgQuerier`, whose `internalStream`
 * hands a `pg-query-stream` object to `query()`: PGlite has no cursor API, so streaming falls back to
 * the base class buffering the whole result. `BEGIN`/`COMMIT` are plain statements on the single
 * connection, leaving transactions to the base class.
 */
export class PgliteQuerier extends AbstractSqlQuerier {
  constructor(
    readonly db: PgliteDatabase,
    dialect: PgliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.db.query<T>(query, values);
    return res.rows;
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.db.query<RawRow>(query, values);
    // `affectedRows`, not `rowCount`: PGlite derives the former from the command tag of a write only,
    // where the latter also counts a `SELECT`'s rows and is absent altogether from a DDL tag.
    return this.buildUpdateResult({ rows: res.rows, changes: res.affectedRows ?? 0 });
  }

  /** The handle belongs to the pool, which hands out one querier per unit of work over it. */
  override async internalRelease() {}
}
