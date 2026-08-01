import type { ExtraOptions } from '../type/index.js';
import { PreparedSqliteQuerier, type SqlitePreparedStatement } from './abstractSqliteQuerier.js';
import type { SqliteDialect } from './sqliteDialect.js';

/**
 * Structural subset of a synchronous better-sqlite3-compatible driver, declared locally so this
 * querier carries no vendor type. A real `better-sqlite3` `Database` satisfies it directly;
 * `bun:sqlite` is adapted to it by {@link Sqlite3QuerierPool}.
 */
export type SqliteDatabase = {
  prepare(sql: string): SqlitePreparedStatement;
  /** Installs a loadable extension (`sqlite-vec`, ...) into this connection. */
  loadExtension(path: string): void;
  close(): unknown;
};

export class SqliteQuerier extends PreparedSqliteQuerier {
  constructor(
    readonly db: SqliteDatabase,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override prepare(query: string) {
    return this.db.prepare(query);
  }
}
