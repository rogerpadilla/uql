import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
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
 * Pool for a SQLite database opened in this process, whichever driver provides it.
 *
 * The handle is shared - SQLite gives one connection per file - but each acquisition gets its own
 * querier, so transaction state stays per unit of work. Subclasses supply only {@link createDb}: the
 * lifecycle, and loading the extensions on the way up, are the same for `better-sqlite3`, `bun:sqlite`
 * and `node:sqlite`, and were written out once per pool before.
 */
export abstract class AbstractLocalSqliteQuerierPool<O extends LocalSqlitePoolOptions> extends AbstractSqlQuerierPool<
  SqliteQuerier,
  SqliteDialect
> {
  private db?: SqliteDatabase;

  constructor(
    readonly opts?: O,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect({ namingStrategy: extra?.namingStrategy }), extra);
  }

  /** Opens the driver's database. Extensions are loaded by the caller, not here. */
  protected abstract createDb(): Promise<SqliteDatabase>;

  async getQuerier() {
    this.db ??= await this.openDb();
    return new SqliteQuerier(this.db, this.dialect, this.extra);
  }

  private async openDb(): Promise<SqliteDatabase> {
    const db = await this.createDb();
    for (const extension of this.opts?.extensions ?? []) {
      db.loadExtension(extension);
    }
    return db;
  }

  async end() {
    await this.db?.close();
    this.db = undefined;
  }
}
