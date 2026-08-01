import type { SqliteBindValue, SqliteRunResult } from './abstractSqliteQuerier.js';
import type { SqliteDatabase } from './sqliteQuerier.js';

/** A `bun:sqlite` statement: better-sqlite3-shaped, except it reports columns instead of `reader`. */
type BunStatement = {
  columnNames: string[];
  all(...values: SqliteBindValue[]): unknown[];
  run(...values: SqliteBindValue[]): SqliteRunResult;
  iterate(...values: SqliteBindValue[]): Iterable<unknown>;
};

type BunDatabase = {
  prepare(sql: string): BunStatement;
  loadExtension(path: string): void;
  close(): unknown;
};

/**
 * Presents a `bun:sqlite` handle as a {@link SqliteDatabase}.
 *
 * @remarks Its statements expose no `reader`, so without deriving one every `RETURNING` statement
 * would take the `run()` path, which discards returned rows, and inserts would report no ids.
 * `columnNames` is non-empty for exactly the statements better-sqlite3 marks as readers.
 *
 * Lives in a `.bun.ts` file because it only ever executes under Bun: the Node coverage run cannot
 * reach it, and `sqliteQuerier.bun.test.ts` covers it under `test:bun` instead.
 */
export function adaptBunSqlite(db: BunDatabase): SqliteDatabase {
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        reader: stmt.columnNames.length > 0,
        all: (...values) => stmt.all(...values),
        run: (...values) => stmt.run(...values),
        iterate: (...values) => stmt.iterate(...values),
      };
    },
    loadExtension: (path: string) => db.loadExtension(path),
    close: () => db.close(),
  };
}
