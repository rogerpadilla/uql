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
  // `run()` and `all()` share the same `D1Result` shape (both carry `results`), which matters
  // for statements with a RETURNING clause.
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

export class D1Querier extends AbstractSqliteQuerier {
  constructor(
    readonly db: D1Database,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const stmt = this.db.prepare(query);
    const bound = values?.length ? stmt.bind(...values) : stmt;
    const res = await bound.all<T>();
    return res.results;
  }

  override async internalRun(query: string, values?: unknown[]) {
    const stmt = this.db.prepare(query);
    const bound = values?.length ? stmt.bind(...values) : stmt;
    const res = await bound.run<RawRow>();
    const rows = res.results;
    const changes = rows.length || res.meta?.changes || 0;
    return this.buildUpdateResult({ rows, changes, id: res.meta?.last_row_id });
  }

  override async internalRelease() {
    // no-op
  }
}
