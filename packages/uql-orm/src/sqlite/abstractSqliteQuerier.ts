import { AbstractSqlQuerier } from '../querier/index.js';
import type { RawRow } from '../type/index.js';
import { throwPendingTransaction } from '../util/index.js';

/**
 * Values every SQLite driver accepts as a bound parameter.
 *
 * @remarks No `boolean`: SQLite has no boolean storage class, and both `better-sqlite3` ("SQLite3 can
 * only bind numbers, strings, bigints, buffers, and null") and `node:sqlite` reject one outright. The
 * dialect already binds booleans as integers (`booleanLiteral: 'integer'`), so nothing reaches a
 * driver as one; leaving `boolean` here only invited a runtime throw that is now a compile error.
 */
export type SqliteBindValue = null | string | number | bigint | Uint8Array;

/** Header a SQLite driver returns for a statement without a `RETURNING` clause. */
export type SqliteRunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

/** Bound parameters reach a driver as `unknown[]` from the compiler; every driver types them narrowly. */
export function toSqliteBindValues(values?: unknown[]): SqliteBindValue[] {
  return (values || []) as SqliteBindValue[];
}

/**
 * A prepared statement from a driver with better-sqlite3 semantics. `better-sqlite3` and `bun:sqlite`
 * answer synchronously, `@tursodatabase/database` with promises, and {@link PreparedSqliteQuerier}
 * awaits either.
 */
export type SqlitePreparedStatement = {
  /** True for any statement returning rows, including one with a `RETURNING` clause. */
  readonly reader: boolean;
  all(...values: SqliteBindValue[]): unknown[] | Promise<unknown[]>;
  run(...values: SqliteBindValue[]): SqliteRunResult | Promise<SqliteRunResult>;
  iterate(...values: SqliteBindValue[]): Iterable<unknown> | AsyncIterable<unknown>;
};

export abstract class AbstractSqliteQuerier extends AbstractSqlQuerier {
  /**
   * SQLite drivers hold a single shared handle rather than a connection from a pool, so releasing
   * a querier returns nothing; it only asserts the unit of work was finished. Drivers owning a
   * closable per-querier connection override this.
   */
  override async internalRelease() {
    if (this.hasOpenTransaction) {
      throwPendingTransaction();
    }
  }
}

/**
 * Querier for the SQLite drivers that expose prepared statements: `better-sqlite3`, `bun:sqlite`
 * (through `adaptBunSqlite`) and the embedded Turso engine. They differ only in whether preparing and
 * stepping are synchronous, which `await` and `for await` absorb, so the read/write/stream logic -
 * including the `reader` rule below, whose loss silently drops inserted ids - is written once.
 */
export abstract class PreparedSqliteQuerier extends AbstractSqliteQuerier {
  protected abstract prepare(query: string): SqlitePreparedStatement | Promise<SqlitePreparedStatement>;

  override async internalAll<T>(query: string, values?: unknown[]) {
    const stmt = await this.prepare(query);
    return (await stmt.all(...toSqliteBindValues(values))) as T[];
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const stmt = await this.prepare(query);
    for await (const row of stmt.iterate(...toSqliteBindValues(values))) {
      yield row as T;
    }
  }

  override async internalRun(query: string, values?: unknown[]) {
    const stmt = await this.prepare(query);
    // `reader` is true for any statement with a RETURNING clause; `.run()` silently discards
    // returned rows, so those statements must go through `.all()` instead.
    if (stmt.reader) {
      const rows = (await stmt.all(...toSqliteBindValues(values))) as RawRow[];
      return this.buildUpdateResult({ rows });
    }
    const { changes, lastInsertRowid } = await stmt.run(...toSqliteBindValues(values));
    return this.buildUpdateResult({ changes, id: lastInsertRowid });
  }
}
