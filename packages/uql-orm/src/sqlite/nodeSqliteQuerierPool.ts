import type { ExtraOptions } from '../type/index.js';
import { AbstractLocalSqliteQuerierPool, type LocalSqlitePoolOptions } from './localSqliteQuerierPool.js';
import { adaptNodeSqlite } from './nodeSqliteAdapter.js';
import type { SqliteDatabase } from './sqliteQuerier.js';

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
 * Pool backed by Node's built-in `node:sqlite`, so SQLite works with **no dependency at all** rather
 * than requiring the `better-sqlite3` native build. Use {@link Sqlite3QuerierPool} instead when you
 * want `better-sqlite3`, or are on Bun.
 *
 * @remarks `node:sqlite` needs no CLI flag from Node 22.13, and is still a release candidate
 * (stability 1.2) as of Node 26, so `better-sqlite3` via {@link Sqlite3QuerierPool} remains the
 * faster option for read-heavy work.
 */
export class NodeSqliteQuerierPool extends AbstractLocalSqliteQuerierPool<NodeSqlitePoolOptions> {
  constructor(
    readonly filename = ':memory:',
    opts?: NodeSqlitePoolOptions,
    extra?: ExtraOptions,
  ) {
    super(opts, extra);
  }

  protected override async createDb(): Promise<SqliteDatabase> {
    const { DatabaseSync } = await import('node:sqlite');
    const { extensions, ...driverOpts } = this.opts ?? {};
    const nodeDb = new DatabaseSync(this.filename, {
      ...driverOpts,
      // `node:sqlite` refuses `loadExtension` unless the database was opened with this on.
      ...(extensions?.length ? { allowExtension: true } : undefined),
    });
    nodeDb.exec('PRAGMA journal_mode = WAL');
    nodeDb.exec('PRAGMA foreign_keys = ON');
    return adaptNodeSqlite(nodeDb);
  }
}
