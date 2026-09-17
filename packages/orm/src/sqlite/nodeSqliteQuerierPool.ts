import type { ExtraOptions } from '../type/index.js';
import {
  AbstractLocalSqliteQuerierPool,
  adaptSqlite,
  type LocalSqliteDatabase,
  type LocalSqlitePoolOptions,
} from './localSqliteQuerierPool.js';

/**
 * The `DatabaseSync` options worth surfacing, plus the loadable extensions to install. Declared here
 * rather than imported from `node:sqlite` so this module needs no ambient Node types; unknown keys
 * are ignored by the driver, so the list only has to cover what callers actually set.
 */
export type NodeSqlitePoolOptions = LocalSqlitePoolOptions & {
  readonly readOnly?: boolean;
  readonly enableForeignKeyConstraints?: boolean;
  /** Milliseconds a locked database is retried before `SQLITE_BUSY`. */
  readonly timeout?: number;
};

/**
 * A pool over Node's built-in `node:sqlite`, needing no dependency at all. {@link Sqlite3QuerierPool} is the
 * faster choice for read-heavy work, and the one on Bun.
 */
export class NodeSqliteQuerierPool extends AbstractLocalSqliteQuerierPool<NodeSqlitePoolOptions> {
  constructor(
    readonly filename = ':memory:',
    opts?: NodeSqlitePoolOptions,
    extra?: ExtraOptions,
  ) {
    super(opts, extra);
  }

  protected override async createDb(): Promise<LocalSqliteDatabase> {
    const { DatabaseSync } = await import('node:sqlite');
    const { extensions, ...driverOpts } = this.opts ?? {};
    const nodeDb = new DatabaseSync(this.filename, {
      ...driverOpts,
      // Integers as `bigint`, which the querier decodes exactly past 2^53.
      readBigInts: true,
      // `node:sqlite` refuses `loadExtension` unless the database was opened with this on.
      ...(extensions?.length ? { allowExtension: true } : undefined),
    });
    return adaptSqlite(nodeDb, (stmt) => stmt.columns().length > 0);
  }
}
