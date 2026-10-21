import { AbstractSqlQuerier, type BoundStatement } from '../querier/index.js';
import { type SqliteBindValue, toBindValues } from '../sqlite/bindValues.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import type { D1SqliteDialect } from './d1SqliteDialect.js';

/** What a statement answers on D1: the rows it read, and how many rows it changed. */
export interface D1Result {
  results: RawRow[];
  meta: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: SqliteBindValue[]): D1PreparedStatement;
  /** Documented by D1 as the same call as `run()`: both answer the rows and `meta.changes`. */
  all(): Promise<D1Result>;
}

/**
 * What uql calls on D1: a binding (`env.DB`) and a session from `env.DB.withSession()` - how a
 * read-replicated database is read - answer it alike. Both are typed by `@cloudflare/workers-types`.
 */
export interface D1Queryable {
  prepare(query: string): D1PreparedStatement;
  /** Runs `statements` in order as one transaction, answering each one's result. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export class D1Querier extends AbstractSqlQuerier {
  constructor(
    readonly db: D1Queryable,
    dialect: D1SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override async execute(sql: string, values?: unknown[]) {
    return executionOf(await this.prepared(sql, values).all());
  }

  /** A list as one `batch()`, which D1 runs in order as one transaction: the one it has. */
  protected override async executeBatch(statements: readonly BoundStatement[]) {
    const results = await this.db.batch(statements.map(({ sql, values }) => this.prepared(sql, values)));
    return results.map(executionOf);
  }

  /** D1 answers `BEGIN` with `D1_ERROR: not authorized`: a `batch()` is its only transaction. */
  protected override async internalBegin(): Promise<void> {
    throw new UqlUsageError('Cloudflare D1 has no transactions: write the changes as one statement, or idempotently');
  }

  /** A write split in steps a list cannot carry lands step by step, there being no transaction to hold it. */
  protected override atomically<T>(write: () => Promise<T>): Promise<T> {
    return write();
  }

  private prepared(sql: string, values?: readonly unknown[]): D1PreparedStatement {
    const stmt = this.db.prepare(sql);
    const args = toBindValues(values);
    return args.length ? stmt.bind(...args) : stmt;
  }
}

/** What a statement answered, as the querier reads it: D1 answers no `bigint`, so nothing is decoded. */
function executionOf({ results, meta }: D1Result): SqlExecution {
  return { rows: results, changes: meta.changes };
}
