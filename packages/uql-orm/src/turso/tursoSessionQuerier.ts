import { AbstractSqliteQuerier, type SqliteBindValue } from '../sqlite/abstractSqliteQuerier.js';
import type { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';

/** What a statement comes back with on a session: each row an array of its values, named by `columns`. */
export type TursoResultSet = {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
};

/** A value as the server encodes it on a cursor, which the driver's `decodeValue` reads. */
export type TursoValue = {
  type: 'null' | 'integer' | 'float' | 'text' | 'blob';
  value?: string | number;
  base64?: string;
};

/** One entry of a statement's cursor: its columns, a row, the end of a step, or an error. */
export type TursoCursorEntry = {
  type: 'step_begin' | 'step_end' | 'step_error' | 'row' | 'error';
  cols?: { name: string }[];
  row?: TursoValue[];
  error?: { message: string; code?: string };
};

/**
 * The part of a `@tursodatabase/serverless` `Session` the querier uses: one server stream, which every
 * statement on it shares, since each request carries the baton of the response before it.
 */
export type TursoSession = {
  execute(sql: string, args: SqliteBindValue[], safeIntegers: boolean): Promise<TursoResultSet>;
  executeRaw(sql: string, args: SqliteBindValue[]): Promise<{ entries: AsyncIterable<TursoCursorEntry> }>;
  close(): Promise<void>;
};

/**
 * Querier for Turso Cloud on a session of its own.
 *
 * @remarks The stream is what makes a transaction plain `BEGIN`/`COMMIT`, left to the base class, and
 * what `release` closes. A row comes back an array carrying its column names as hidden properties, so it
 * is rebuilt as the object every querier answers.
 */
export class TursoSessionQuerier extends AbstractSqliteQuerier {
  constructor(
    readonly session: TursoSession,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override async execute(query: string, values?: unknown[]) {
    const { columns, rows, rowsAffected } = await this.session.execute(query, toBindValues(values), true);
    return { rows: rows.map((row) => toRow(columns, row)), changes: rowsAffected };
  }

  /** Row by row off the statement's cursor, as the server steps it, each decoded as `execute` decodes one. */
  override async *internalStream<T>(query: string, values?: unknown[]) {
    const { DatabaseError, decodeValue } = await import('@tursodatabase/serverless');
    const { entries } = await this.session.executeRaw(query, toBindValues(values));
    let columns: string[] = [];
    for await (const entry of entries) {
      if (entry.type === 'step_error' || entry.type === 'error') {
        throw new DatabaseError(entry.error?.message ?? 'SQL execution failed', entry.error?.code);
      }
      if (entry.cols) {
        columns = entry.cols.map(({ name }) => name);
      }
      if (entry.row) {
        yield decodeBigInts(
          toRow(
            columns,
            entry.row.map((value) => decodeValue(value, true)),
          ),
        ) as T;
      }
    }
  }

  override async internalRelease() {
    await this.session.close();
  }
}

/** A row the driver answers as an array of values, named by the statement's columns. */
function toRow(columns: readonly string[], values: readonly unknown[]): RawRow {
  return Object.fromEntries(columns.map((column, at) => [column, values[at]]));
}

/** Bound parameters reach a driver as `unknown[]` from the compiler; a session binds them as they are. */
function toBindValues(values?: unknown[]): SqliteBindValue[] {
  return (values ?? []) as SqliteBindValue[];
}
