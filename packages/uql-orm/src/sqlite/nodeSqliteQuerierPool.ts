import { AbstractSqlQuerierPool } from '../querier/index.js';
import type { ExtraOptions } from '../type/index.js';
import { adaptNodeSqlite } from './nodeSqliteAdapter.js';
import { SqliteDialect } from './sqliteDialect.js';
import { type SqliteDatabase, SqliteQuerier } from './sqliteQuerier.js';

/**
 * The `DatabaseSync` options worth surfacing, plus the loadable extensions to install. Declared here
 * rather than imported from `node:sqlite` so this module needs no ambient Node types; unknown keys
 * are ignored by the driver, so the list only has to cover what callers actually set.
 */
export type NodeSqlitePoolOptions = {
  readonly readOnly?: boolean;
  readonly enableForeignKeyConstraints?: boolean;
  /** Milliseconds a locked database is retried before `SQLITE_BUSY`. */
  readonly timeout?: number;
  /**
   * Paths of loadable extensions to install when the connection opens - e.g. what `sqlite-vec`'s
   * `getLoadablePath()` returns, which vector search needs because SQLite itself has no vector
   * functions. Their presence also turns on `allowExtension`, which `node:sqlite` requires before
   * `loadExtension` will run at all.
   */
  readonly extensions?: readonly string[];
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
export class NodeSqliteQuerierPool extends AbstractSqlQuerierPool<SqliteQuerier, SqliteDialect> {
  private db?: SqliteDatabase;

  constructor(
    readonly filename = ':memory:',
    readonly opts?: NodeSqlitePoolOptions,
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
    const { DatabaseSync } = await import('node:sqlite');
    const { extensions, ...driverOpts } = this.opts ?? {};
    const nodeDb = new DatabaseSync(this.filename, {
      ...driverOpts,
      ...(extensions?.length ? { allowExtension: true } : undefined),
    });
    nodeDb.exec('PRAGMA journal_mode = WAL');
    const db = adaptNodeSqlite(nodeDb);
    for (const extension of extensions ?? []) {
      db.loadExtension(extension);
    }
    return db;
  }

  async end() {
    await this.db?.close();
    this.db = undefined;
  }
}
