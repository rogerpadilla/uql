import { AbstractSqlQuerier } from '../querier/index.js';
import { SqliteDialect } from '../sqlite/index.js';
import type { ExtraOptions, QueryUpdateResult } from '../type/index.js';

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

export class D1Querier extends AbstractSqlQuerier {
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
    // For now, we return 0 for firstId if not explicitly available, relying on UUIDs or RETURNING in future.
    const changes = res.meta?.changes ?? res.count ?? 0;
    const lastId = res.meta?.last_row_id;
    let firstId: number | undefined;
    let ids: number[] = [];

    if (lastId && changes > 0) {
      firstId = lastId - (changes - 1);
      ids = Array.from({ length: changes }, (_, i) => (firstId as number) + i);
    }

    return { changes, ids, firstId } satisfies QueryUpdateResult;
  }

  override async internalRelease() {
    // no-op
  }
}
