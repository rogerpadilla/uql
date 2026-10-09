import type { Options } from 'better-sqlite3';
import { dialectOptionsFrom } from '../dialect/abstractDialect.js';
import type { ExtraOptions } from '../type/index.js';
import {
  AbstractLocalSqliteQuerierPool,
  adaptSqlite,
  type LocalSqliteDatabase,
  type LocalSqlitePoolOptions,
  extendSqlite,
} from './localSqliteQuerierPool.js';
import { SqliteDialect } from './sqliteDialect.js';

/** Driver options, plus the loadable extensions to install on the connection. */
export type SqlitePoolOptions = Options & LocalSqlitePoolOptions;

/**
 * Pool for `better-sqlite3`, or `bun:sqlite` when running under Bun - the same file, through whichever
 * driver the runtime provides.
 */
export class SqliteQuerierPool extends AbstractLocalSqliteQuerierPool<LocalSqliteDatabase, SqliteDialect> {
  constructor(
    readonly filename: string | Buffer = ':memory:',
    readonly opts?: SqlitePoolOptions,
    extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(dialectOptionsFrom(extra)), extra);
  }

  /**
   * `bun:sqlite` rejects option keys it does not know, so `extensions` is stripped out, and opens only a
   * path, so a serialized database - which better-sqlite3 takes as its filename - is deserialized there instead.
   */
  protected override async createDb(): Promise<LocalSqliteDatabase> {
    const { extensions, ...driverOpts } = this.opts ?? {};

    if (typeof Bun !== 'undefined') {
      const { Database } = await import('bun:sqlite');
      const bunOpts = { ...driverOpts, safeIntegers: true };
      const bunDb =
        typeof this.filename === 'string'
          ? new Database(this.filename, bunOpts)
          : Database.deserialize(this.filename, bunOpts);
      return extendSqlite(
        adaptSqlite(bunDb, (stmt) => stmt.columnNames.length > 0),
        extensions,
      );
    }
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    return extendSqlite(new BetterSqlite3(this.filename, driverOpts).defaultSafeIntegers(true), extensions);
  }
}
