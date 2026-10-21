import { AbstractSqlQuerier } from '../querier/index.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import type { PgliteDialect } from './pgliteDialect.js';

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
    dialect: PgliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  /** Every querier of the pool is this one handle's session, so they share its transaction. */
  protected override get connection(): object {
    return this.db;
  }

  /**
   * `affectedRows`, not `rowCount`: PGlite derives the former from the command tag of a write only, where the
   * latter also counts a `SELECT`'s rows and is absent altogether from a DDL tag.
   */
  protected override async execute(sql: string, values?: unknown[]) {
    const { rows, affectedRows } = await this.db.query<RawRow>(sql, values);
    return { rows, changes: affectedRows };
  }
}
