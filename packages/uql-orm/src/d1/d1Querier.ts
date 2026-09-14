import { AbstractSqliteQuerier } from '../sqlite/abstractSqliteQuerier.js';
import type { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions, RawRow } from '../type/index.js';

export interface D1Meta {
  duration?: number;
  size_after?: number;
  rows_read?: number;
  rows_written?: number;
  last_row_id?: number;
  changed_db?: boolean;
  changes?: number;
  [key: string]: unknown;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: D1Meta;
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
  meta?: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  /** Documented by D1 as an alias of {@link all}: both answer the rows and `meta.changes`. */
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

/**
 * The only part of a D1 binding the querier uses: what a {@link D1Database} and a session from
 * `withSession()`, which a read-replicated database is read through, both have.
 */
export type D1Preparer = Pick<D1Database, 'prepare'>;

export class D1Querier extends AbstractSqliteQuerier {
  constructor(
    readonly db: D1Preparer,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override async execute(query: string, values?: unknown[]) {
    const stmt = this.db.prepare(query);
    const { results, meta } = await (values?.length ? stmt.bind(...values) : stmt).all<RawRow>();
    return { rows: results, changes: meta.changes ?? 0 };
  }

  /** D1 answers `BEGIN` with `D1_ERROR: not authorized`: a single statement is its only atomic unit. */
  protected override async internalBegin(): Promise<void> {
    throw new TypeError('Cloudflare D1 has no transactions: write the changes as one statement, or idempotently');
  }
}
