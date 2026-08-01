import type { SqliteBindValue } from './abstractSqliteQuerier.js';
import type { SqliteDatabase } from './sqliteQuerier.js';

/**
 * A `node:sqlite` statement: better-sqlite3-shaped, except it describes columns instead of reporting
 * `reader`, and types `changes` as possibly `bigint` where better-sqlite3 always answers a `number`.
 */
type NodeSqliteStatement = {
  columns(): readonly unknown[];
  all(...values: SqliteBindValue[]): unknown[];
  run(...values: SqliteBindValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(...values: SqliteBindValue[]): Iterable<unknown>;
};

/**
 * Structural subset of `node:sqlite`'s `DatabaseSync`, declared locally for the same reason the rest
 * of this folder declares its driver shapes: nothing here depends on `@types/node` being in scope.
 */
export type NodeSqliteDatabase = {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  loadExtension(path: string): void;
  close(): void;
};

/**
 * Presents a `node:sqlite` handle as a {@link SqliteDatabase}.
 *
 * @remarks Its statements expose no `reader`, so without deriving one every `RETURNING` statement
 * would take the `run()` path, which discards returned rows, and inserts would report no ids.
 * `columns()` is non-empty for exactly the statements better-sqlite3 marks as readers, including
 * `INSERT ... RETURNING` and `DELETE ... RETURNING`.
 */
export function adaptNodeSqlite(db: NodeSqliteDatabase): SqliteDatabase {
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        reader: stmt.columns().length > 0,
        all: (...values) => stmt.all(...values),
        // `changes` is narrowed to `number` to match every other driver; a row count cannot exceed
        // the safe-integer range, so nothing is lost. `lastInsertRowid` keeps its `bigint` arm.
        run: (...values) => {
          const { changes, lastInsertRowid } = stmt.run(...values);
          return { changes: Number(changes), lastInsertRowid };
        },
        iterate: (...values) => stmt.iterate(...values),
      };
    },
    loadExtension: (path: string) => db.loadExtension(path),
    close: () => db.close(),
  };
}
