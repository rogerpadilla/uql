import type { PostgresDialect } from '../postgres/postgresDialect.js';
import { AbstractSqlQuerier } from '../querier/index.js';
import type { ExtraOptions, RawRow } from '../type/index.js';

/** The two methods uql uses of `@electric-sql/pglite`, stated so its published types do not depend on a pre-1.0 package. */
export type PgliteDatabase = {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  close(): Promise<void>;
};

/**
 * Querier for PGlite, Postgres compiled to WASM and run in this process.
 *
 * @remarks Extends {@link AbstractSqlQuerier} rather than `PgQuerier`, whose stream needs `pg-query-stream`,
 * which PGlite's client cannot run. `BEGIN`/`COMMIT` are plain statements on the single connection.
 */
export class PgliteQuerier extends AbstractSqlQuerier {
  constructor(
    readonly db: PgliteDatabase,
    dialect: PostgresDialect,
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
