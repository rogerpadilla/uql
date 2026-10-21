import { AbstractSqlQuerier } from '../querier/index.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';
import { type SqliteBindValue, toBindValues } from './bindValues.js';
import type { SqliteDialect } from './sqliteDialect.js';

/**
 * What uql reads of a driver's `run()`: the row count, which `node:sqlite` answers as a `bigint` once it
 * reads integers as ones. An inserted id comes back through `RETURNING`.
 */
export type SqliteRunResult = {
  changes: number | bigint;
};

/** A prepared statement with better-sqlite3 semantics, answering at once or with a promise. */
export type SqlitePreparedStatement = {
  /** True for any statement returning rows, including one with a `RETURNING` clause. */
  readonly reader: boolean;
  all(...values: SqliteBindValue[]): unknown[] | Promise<unknown[]>;
  run(...values: SqliteBindValue[]): SqliteRunResult | Promise<SqliteRunResult>;
  iterate(...values: SqliteBindValue[]): Iterable<unknown> | AsyncIterable<unknown>;
};

/**
 * A SQLite driver that prepares statements. `better-sqlite3` and the embedded Turso engine satisfy it
 * as they are, `bun:sqlite` and `node:sqlite` through `adaptSqlite`.
 */
export type SqliteDatabase = {
  prepare(sql: string): SqlitePreparedStatement | Promise<SqlitePreparedStatement>;
  close(): unknown;
};

/**
 * Querier for the SQLite drivers that prepare statements: `better-sqlite3`, `bun:sqlite`, `node:sqlite`
 * and the embedded Turso engine. They differ only in whether preparing and stepping answer at once or
 * with a promise, which `await` and `for await` absorb.
 */
export class SqliteQuerier extends AbstractSqlQuerier {
  constructor(
    readonly db: SqliteDatabase,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  /** Every querier of the pool is this one handle's session, so they share its transaction. */
  protected override get connection(): object {
    return this.db;
  }

  /** `reader` picks the call: `run()` would discard the rows of a statement that reads, RETURNING included. */
  protected override async execute(sql: string, values?: unknown[]) {
    const stmt = await this.db.prepare(sql);
    if (stmt.reader) {
      return { rows: ((await stmt.all(...toBindValues(values))) as RawRow[]).map(decodeBigInts) };
    }
    return { rows: [], changes: Number((await stmt.run(...toBindValues(values))).changes) };
  }

  /** Row by row, as the driver steps the statement. */
  override async *internalStream(sql: string, values?: unknown[]) {
    const stmt = await this.db.prepare(sql);
    for await (const row of stmt.iterate(...toBindValues(values)) as Iterable<RawRow> | AsyncIterable<RawRow>) {
      yield decodeBigInts(row);
    }
  }
}
