import type { Options } from 'better-sqlite3';
import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { SqliteDialect } from './sqliteDialect.js';
import { type SqliteDatabase, SqliteQuerier } from './sqliteQuerier.js';

/** Driver options, plus the loadable extensions to install on the connection. */
export type Sqlite3PoolOptions = Options & {
  /**
   * Paths of loadable extensions to install when the connection opens - e.g. what `sqlite-vec`'s
   * `getLoadablePath()` returns, which vector search needs because SQLite itself has no vector
   * functions.
   */
  extensions?: readonly string[];
};

export class Sqlite3QuerierPool extends AbstractSqlQuerierPool<SqliteQuerier, SqliteDialect> {
  private db?: SqliteDatabase;

  constructor(
    readonly filename: string | Buffer = ':memory:',
    readonly opts?: Sqlite3PoolOptions,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect({ namingStrategy: extra?.namingStrategy }), extra);
  }

  /**
   * The database handle is shared (single connection), but each acquisition gets its own querier
   * so transaction state stays per unit of work.
   */
  async getQuerier() {
    this.db ??= await this.openDb();
    return new SqliteQuerier(this.db, this.dialect, this.extra);
  }

  private async openDb(): Promise<SqliteDatabase> {
    // `bun:sqlite` rejects option keys it does not know, and rejects an options object carrying no
    // open flags, so `extensions` is stripped out and what remains of it collapses back to nothing.
    const { extensions, ...driverOpts } = this.opts ?? {};
    const db = await this.openDriverDb(Object.keys(driverOpts).length > 0 ? driverOpts : undefined);
    for (const extension of extensions ?? []) {
      db.loadExtension(extension);
    }
    return db;
  }

  private async openDriverDb(opts?: Options): Promise<SqliteDatabase> {
    if (typeof Bun !== 'undefined') {
      const { Database: BunDatabase } = await import('bun:sqlite');
      const { adaptBunSqlite } = await import('./bunSqliteAdapter.bun.js');
      const bunDb = new BunDatabase(this.filename as string, opts);
      bunDb.run('PRAGMA journal_mode = WAL');
      return adaptBunSqlite(bunDb);
    }
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const db = new BetterSqlite3(this.filename, opts);
    db.pragma('journal_mode = WAL');
    return db;
  }

  async end() {
    await this.db?.close();
    this.db = undefined;
  }
}
