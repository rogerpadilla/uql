import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { ExtraOptions } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { applySqlitePragmas } from './sqlitePragmas.js';
import { type SqliteDatabase, SqliteQuerier } from './sqliteQuerier.js';

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
 * Pool for a SQLite database opened in this process, whichever driver provides it. SQLite gives one
 * connection per file, so the shared-handle lifecycle is {@link AbstractSharedHandleQuerierPool}'s.
 *
 * Subclasses supply only {@link createDb}: configuring the connection on the way up - the pragmas,
 * then the extensions - is the same for `better-sqlite3`, `bun:sqlite` and `node:sqlite`.
 */
export abstract class AbstractLocalSqliteQuerierPool<
  O extends LocalSqlitePoolOptions,
> extends AbstractSharedHandleQuerierPool<SqliteDatabase, SqliteQuerier, SqliteDialect> {
  constructor(
    readonly opts?: O,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(dialectOptionsFrom(extra)), extra);
  }

  /** Opens the driver's database, and nothing more: the caller configures it. */
  protected abstract createDb(): Promise<SqliteDatabase>;

  protected override async openDb(): Promise<SqliteDatabase> {
    const db = await this.createDb();
    await applySqlitePragmas(db);
    for (const extension of this.opts?.extensions ?? []) {
      db.loadExtension(extension);
    }
    return db;
  }

  protected override buildQuerier(db: SqliteDatabase) {
    return new SqliteQuerier(db, this.dialect, this.extra);
  }
}
