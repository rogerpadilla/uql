import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { applySqlitePragmas } from './sqlitePragmas.js';
import { type SqlitePreparedStatement, SqliteQuerier } from './sqliteQuerier.js';

/** What every local SQLite pool accepts on top of its driver's own options. */
export type LocalSqlitePoolOptions = {
  /**
   * Paths of loadable extensions to install when the connection opens - e.g. what `sqlite-vec`'s
   * `getLoadablePath()` returns, which vector search needs because SQLite itself has no vector
   * functions.
   */
  extensions?: readonly string[];
};

/**
 * A database opened in this process by a driver that answers at once, and installs loadable extensions
 * (`sqlite-vec`, ...) into its connection.
 */
export type LocalSqliteDatabase = {
  prepare(sql: string): SqlitePreparedStatement;
  loadExtension(path: string): void;
  close(): unknown;
};

/**
 * Pool for a SQLite database opened in this process, whichever driver provides it. SQLite gives one
 * connection per file, so the shared-handle lifecycle is {@link AbstractSharedHandleQuerierPool}'s.
 *
 * Subclasses supply only {@link createDb}: configuring the connection on the way up - the pragmas,
 * then the extensions - is the same for `better-sqlite3`, `bun:sqlite` and `node:sqlite`.
 */
export abstract class AbstractLocalSqliteQuerierPool<
  O extends LocalSqlitePoolOptions,
> extends AbstractSharedHandleQuerierPool<LocalSqliteDatabase, SqliteQuerier, SqliteDialect> {
  constructor(
    readonly opts?: O,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(dialectOptionsFrom(extra)), extra);
  }

  /** Opens the driver's database, and nothing more: the caller configures it. */
  protected abstract createDb(): Promise<LocalSqliteDatabase>;

  protected override async openDb(): Promise<LocalSqliteDatabase> {
    const db = await this.createDb();
    await applySqlitePragmas(db);
    for (const extension of this.opts?.extensions ?? []) {
      db.loadExtension(extension);
    }
    return db;
  }

  protected override buildQuerier(db: LocalSqliteDatabase) {
    return new SqliteQuerier(db, this.dialect, this.extra);
  }
}
