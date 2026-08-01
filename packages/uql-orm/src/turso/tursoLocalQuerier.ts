import { PreparedSqliteQuerier, type SqlitePreparedStatement } from '../sqlite/abstractSqliteQuerier.js';
import type { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions } from '../type/index.js';

/**
 * Structural subset of the `@tursodatabase/database` API actually used here, declared locally so
 * this package does not couple its published types to a pre-1.0 dependency.
 */
export type TursoDatabase = {
  prepare(sql: string): Promise<SqlitePreparedStatement>;
  pragma(source: string, options?: unknown): Promise<unknown[]>;
  close(): Promise<void>;
};

/**
 * Querier for the embedded Turso engine.
 *
 * @remarks The engine exposes better-sqlite3 semantics (`reader`, `{changes, lastInsertRowid}`,
 * array-bound values) over an async API, so all it supplies is the awaited `prepare`.
 * `BEGIN`/`COMMIT` work as plain statements, leaving transactions to the base class.
 */
export class TursoLocalQuerier extends PreparedSqliteQuerier {
  constructor(
    readonly db: TursoDatabase,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override prepare(query: string) {
    return this.db.prepare(query);
  }
}
