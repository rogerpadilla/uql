import type { Options } from 'better-sqlite3';
import type { ExtraOptions } from '../type/index.js';
import {
  AbstractLocalSqliteQuerierPool,
  adaptSqlite,
  type LocalSqliteDatabase,
  type LocalSqlitePoolOptions,
} from './localSqliteQuerierPool.js';

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
   * Both drivers read integers as `bigint`, which the querier decodes exactly past 2^53. `bun:sqlite`
   * rejects option keys it does not know, so `extensions` is stripped out, and opens only a path, so a
   * serialized database - which better-sqlite3 takes as its filename - is deserialized there instead.
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
      return adaptSqlite(bunDb, (stmt) => stmt.columnNames.length > 0);
    }
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    return new BetterSqlite3(this.filename, driverOpts).defaultSafeIntegers(true);
  }
}
