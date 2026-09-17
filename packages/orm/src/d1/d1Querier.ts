import { AbstractSqliteQuerier, type SqliteBindValue } from '../sqlite/abstractSqliteQuerier.js';
import type { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { ExtraOptions, RawRow } from '../type/index.js';

/** What a statement answers on D1: the rows it read, and how many rows it changed. */
export interface D1Result<T = unknown> {
  results: T[];
  meta: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  /** Documented by D1 as the same call as `run()`: both answer the rows and `meta.changes`. */
  all<T = unknown>(): Promise<D1Result<T>>;
}

/**
 * What uql calls on D1: a binding (`env.DB`) and a session from `env.DB.withSession()` - how a
 * read-replicated database is read - answer it alike. Both are typed by `@cloudflare/workers-types`.
 */
export interface D1Queryable {
  prepare(query: string): D1PreparedStatement;
}

export class D1Querier extends AbstractSqliteQuerier {
  constructor(
    readonly db: D1Queryable,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
  ) {
    super(dialect, extra);
  }

  protected override async execute(query: string, values: SqliteBindValue[]) {
    const stmt = this.db.prepare(query);
    const { results, meta } = await (values.length ? stmt.bind(...values) : stmt).all<RawRow>();
    return { rows: results, changes: meta.changes ?? 0 };
  }

  /** D1 answers `BEGIN` with `D1_ERROR: not authorized`: a single statement is its only atomic unit. */
  protected override async internalBegin(): Promise<void> {
    throw new TypeError('Cloudflare D1 has no transactions: write the changes as one statement, or idempotently');
  }
}
