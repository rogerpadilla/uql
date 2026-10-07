import { AbstractSharedHandleQuerierPool } from '../querier/abstractSharedHandleQuerierPool.js';
import type { SqliteDialect } from './sqliteDialect.js';
import { type SqliteDatabase, type SqlitePreparedStatement, SqliteQuerier } from './sqliteQuerier.js';

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
  /** Defines a SQL function, which `bun:sqlite` cannot. */
  function?(name: string, options: { deterministic: boolean }, fn: (...args: SqlValue[]) => SqlValue): unknown;
  close(): unknown;
};

/**
 * A `node:sqlite` or `bun:sqlite` handle as a {@link LocalSqliteDatabase}. Neither says whether a statement
 * reads, so `reads` does: taken by `run()`, a RETURNING statement's rows would be lost, and its ids with them.
 */
export function adaptSqlite<S extends Omit<SqlitePreparedStatement, 'reader'>>(
  db: Omit<LocalSqliteDatabase, 'prepare'> & { prepare(sql: string): S },
  reads: (stmt: S) => boolean,
): LocalSqliteDatabase {
  return {
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        reader: reads(stmt),
        all: (...values) => stmt.all(...values),
        run: (...values) => stmt.run(...values),
        iterate: (...values) => stmt.iterate(...values),
      };
    },
    loadExtension: (path) => db.loadExtension(path),
    function: db.function?.bind(db),
    close: () => db.close(),
  };
}

/**
 * `db` extended past SQLite's own: each loadable extension installed, which `node:sqlite` refuses unless
 * opened to allow them, and `REGEXP` defined as libSQL builds it in, which SQLite leaves to the application.
 */
export function extendSqlite(db: LocalSqliteDatabase, extensions: readonly string[] = []): LocalSqliteDatabase {
  for (const extension of extensions) {
    db.loadExtension(extension);
  }
  db.function?.('regexp', { deterministic: true }, regexp);
  return db;
}

/** `value REGEXP pattern`: NULL where the value is, as an operator answers. */
function regexp(pattern: SqlValue, value: SqlValue): SqlValue {
  return value === null ? null : Number(new RegExp(String(pattern)).test(String(value)));
}

/** A value SQLite hands a function, and takes back. */
type SqlValue = string | number | bigint | Uint8Array | null;

/** A pool for a database file opened in this process, configured the same way whichever driver's {@link createDb} opens it. */
export abstract class AbstractLocalSqliteQuerierPool<
  DB extends SqliteDatabase,
  D extends SqliteDialect,
> extends AbstractSharedHandleQuerierPool<DB, SqliteQuerier, D> {
  /** Opens the driver's database, reading integers as `bigint`, which the querier decodes exactly past 2^53. */
  protected abstract createDb(): Promise<DB>;

  /**
   * WAL, so a reader does not wait on the writer, and `foreign_keys`, which SQLite ships off per connection:
   * without it a declared `onDelete: 'CASCADE'` does nothing and a dangling reference is accepted.
   */
  protected override async openDb(): Promise<DB> {
    const db = await this.createDb();
    for (const pragma of ['journal_mode = WAL', 'foreign_keys = ON']) {
      const stmt = await db.prepare(`PRAGMA ${pragma}`);
      // `journal_mode` answers with a row and `foreign_keys` with none.
      await (stmt.reader ? stmt.all() : stmt.run());
    }
    return db;
  }

  protected override buildQuerier(db: DB) {
    return new SqliteQuerier(db, this.dialect, this.extra);
  }
}
