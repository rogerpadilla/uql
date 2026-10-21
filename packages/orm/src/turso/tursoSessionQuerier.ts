import { AbstractSqlQuerier, type BoundStatement } from '../querier/index.js';
import { type SqliteBindValue, sqliteStatements, toBindValues } from '../sqlite/bindValues.js';
import type { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
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
  /**
   * Runs `statements` as one request, stopping at the first failure; with a `mode` the request carries its own
   * `BEGIN` and `COMMIT`, so it is all or none. `raw` answers each row as an array of its values.
   */
  batch(
    statements: { sql: string; args: SqliteBindValue[] }[],
    mode: 'immediate' | undefined,
    queryOptions: undefined,
    safeIntegers: boolean,
    raw: boolean,
  ): Promise<TursoResultSet[]>;
  executeRaw(sql: string, args: SqliteBindValue[]): Promise<{ entries: AsyncIterable<TursoCursorEntry> }>;
  close(): Promise<void>;
};

/** A Turso Cloud querier on a stream of its own, which holds its transaction and which `release` closes. */
export class TursoSessionQuerier extends AbstractSqlQuerier {
  constructor(
    readonly session: TursoSession,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override async execute(sql: string, values?: unknown[]) {
    return executionOf(await this.session.execute(sql, toBindValues(values), true));
  }

  /**
   * A list as one request, all or none: its own `BEGIN IMMEDIATE` and `COMMIT` in it, or, inside an open
   * transaction, none, so it joins it.
   */
  protected override async executeBatch(statements: readonly BoundStatement[]) {
    const mode = this.hasOpenTransaction ? undefined : 'immediate';
    const results = await this.session.batch(sqliteStatements(statements), mode, undefined, true, true);
    return results.map(executionOf);
  }

  /** Row by row off the statement's cursor, as the server steps it, each decoded as `execute` decodes one. */
  override async *internalStream(sql: string, values?: unknown[]) {
    const { DatabaseError, decodeValue } = await import('@tursodatabase/serverless');
    const { entries } = await this.session.executeRaw(sql, toBindValues(values));
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
        );
      }
    }
  }

  override async internalRelease() {
    await this.session.close();
  }
}

/** A statement's result as the querier reads it, each row named by the statement's columns, wide integers decoded. */
function executionOf({ columns, rows, rowsAffected }: TursoResultSet): SqlExecution {
  return { rows: rows.map((row) => decodeBigInts(toRow(columns, row))), changes: rowsAffected };
}

/** A row the driver answers as an array of values, named by the statement's columns. */
function toRow(columns: readonly string[], values: readonly unknown[]): RawRow {
  return Object.fromEntries(columns.map((column, at) => [column, values[at]]));
}
