import { type PgResult, pgExecution } from '../postgres/pgExecution.js';
import { AbstractSqlQuerier } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import type { PgliteDialect } from './pgliteDialect.js';

/** The two methods uql uses of `@electric-sql/pglite`, stated so its published types do not depend on a pre-1.0 package. */
export type PgliteDatabase = {
  query(query: string, params?: unknown[]): Promise<PgResult>;
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
    extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  /** Every querier of the pool is this one handle's session, so they share its transaction. */
  protected override get connection(): object {
    return this.db;
  }

  protected override async execute(sql: string, values?: unknown[]): Promise<SqlExecution> {
    return pgExecution(await this.db.query(sql, values));
  }
}
