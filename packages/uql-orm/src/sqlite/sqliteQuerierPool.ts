import type { Options } from 'better-sqlite3';
import type { ExtraOptions } from '../type/index.js';
import { AbstractLocalSqliteQuerierPool, type LocalSqlitePoolOptions } from './localSqliteQuerierPool.js';
import type { SqliteDatabase } from './sqliteQuerier.js';

/** Driver options, plus the loadable extensions to install on the connection. */
export type Sqlite3PoolOptions = Options & LocalSqlitePoolOptions;

/**
 * Pool for `better-sqlite3`, or `bun:sqlite` when running under Bun - the same file, through whichever
 * driver the runtime provides.
 */
export class Sqlite3QuerierPool extends AbstractLocalSqliteQuerierPool<Sqlite3PoolOptions> {
  constructor(
    readonly filename: string | Buffer = ':memory:',
    opts?: Sqlite3PoolOptions,
    extra?: ExtraOptions,
  ) {
    super(opts, extra);
  }

  /**
   * SQLite ships with foreign keys unenforced, per connection, for backward compatibility. UQL emits the
   * constraints in its DDL, so leaving them off means a declared `onDelete: 'CASCADE'` silently does
   * nothing and a dangling reference is accepted. Enabled here on every driver, as TypeORM also does.
   */
  protected override async createDb(): Promise<SqliteDatabase> {
    // `bun:sqlite` rejects option keys it does not know, and rejects an options object carrying no
    // open flags, so `extensions` is stripped out and what remains of it collapses back to nothing.
    const { extensions, ...driverOpts } = this.opts ?? {};
    const opts = Object.keys(driverOpts).length > 0 ? driverOpts : undefined;

    if (typeof Bun !== 'undefined') {
      const { Database: BunDatabase } = await import('bun:sqlite');
      const { adaptBunSqlite } = await import('./bunSqliteAdapter.bun.js');
      const bunDb = new BunDatabase(this.filename as string, opts);
      bunDb.run('PRAGMA journal_mode = WAL');
      bunDb.run('PRAGMA foreign_keys = ON');
      return adaptBunSqlite(bunDb);
    }
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const db = new BetterSqlite3(this.filename, opts);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  }
}
