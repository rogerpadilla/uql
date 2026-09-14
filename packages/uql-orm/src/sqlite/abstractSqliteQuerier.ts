import { AbstractSqlQuerier } from '../querier/index.js';
import type { RawRow } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';

/**
 * Values every SQLite driver accepts as a bound parameter.
 *
 * @remarks No `boolean`: SQLite has no boolean storage class, and both `better-sqlite3` ("SQLite3 can
 * only bind numbers, strings, bigints, buffers, and null") and `node:sqlite` reject one outright. The
 * dialect already binds booleans as integers (`booleanLiteral: 'integer'`), so nothing reaches a
 * driver as one; leaving `boolean` here only invited a runtime throw that is now a compile error.
 */
export type SqliteBindValue = null | string | number | bigint | Uint8Array;

/** What a statement came back with on a SQLite driver: the rows it read, and how many rows it changed. */
export type SqliteExecution = {
  readonly rows: RawRow[];
  readonly changes: number;
};

/**
 * Querier for every SQLite driver. Each supplies one hook, {@link execute}; what they share - the
 * wide-integer decode, and a RETURNING statement counted by its rows - is written once here.
 */
export abstract class AbstractSqliteQuerier extends AbstractSqlQuerier {
  /** Runs one statement, answering its rows as the driver read them. */
  protected abstract execute(query: string, values?: unknown[]): Promise<SqliteExecution>;

  override async internalAll<T>(query: string, values?: unknown[]) {
    const { rows } = await this.execute(query, values);
    return rows.map(decodeBigInts) as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const { rows, changes } = await this.execute(query, values);
    // A driver's own count is unreliable for a RETURNING statement (Hrana answers 0), so its rows answer.
    return this.buildUpdateResult({ rows: rows.map(decodeBigInts), changes: rows.length || changes });
  }

  /**
   * SQLite drivers hold a single shared handle rather than a connection from a pool, so releasing
   * a querier returns nothing at all. Drivers owning a closable per-querier connection override this.
   */
  override async internalRelease() {}
}
