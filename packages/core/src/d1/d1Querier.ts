import { AbstractSqliteQuerier } from '../sqlite/abstractSqliteQuerier.js';
import { SqliteDialect } from '../sqlite/index.js';
import type { ExtraOptions } from '../type/index.js';

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
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1ExecResult>;
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
    readonly extra?: ExtraOptions,
  ) {
    super(new SqliteDialect(extra?.namingStrategy));
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    const stmt = this.db.prepare(query);
    const bound = values?.length ? stmt.bind(...values) : stmt;
    const res = await bound.all<T>();
    return res.results;
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    const stmt = this.db.prepare(query);
    const bound = values?.length ? stmt.bind(...values) : stmt;
    const res = await bound.run();
    // D1ExecResult doesn't reliably return lastRowId in the type definition,
    // though the runtime meta often has it.
    const changes = res.meta?.changes ?? res.count ?? 0;
    const lastInsertRowid = res.meta?.last_row_id;
    return this.buildUpdateResult(changes, lastInsertRowid);
  }

  override async internalRelease() {
    // no-op
  }
}
