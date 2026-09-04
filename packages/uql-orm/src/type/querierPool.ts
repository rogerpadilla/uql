import type { AbstractDialect, AbstractSqlDialect } from '../dialect/index.js';
import type { ExtraOptions, Querier, SqlQuerier, TransactionOptions } from './querier.js';
import type { UqlContext } from './query.js';
import type { UniversalQuerier } from './universalQuerier.js';

/** Options for a pool-level unit of work ({@link QuerierPool.withQuerier} / {@link QuerierPool.transaction}). */
export interface PoolRunOptions {
  /**
   * {@link UqlContext} to run the callback under, so parameterized/`security` filters scope every
   * query inside it. Same mechanism as `withContext`, scoped to this unit of work - ideal where no
   * ambient request context exists (background pipelines, queue consumers, webhooks) and the tenant
   * is known locally: `pool.withQuerier((q) => q.findMany(Invoice, {}), { context: { tenantId } })`.
   */
  readonly context?: UqlContext;
}

/**
 * Querier pool. Read the dialect id via `pool.dialect.dialectName` (see {@link AbstractDialect.dialectName}); queriers expose the same on `querier.dialect`.
 *
 * A pool is a {@link UniversalQuerier} too, so a function that runs queries takes that type and the
 * caller passes its own querier or the pool. `pool.op(...)` is exactly
 * `pool.withQuerier((querier) => querier.op(...))`, so two pool calls are two units of work; when they
 * must commit together, that is `transaction`.
 *
 * Acquiring per call is also what makes `Promise.all([pool.findMany(A, {}), pool.count(B, {})])` run on
 * separate connections, while the same calls inside one `withQuerier`/`transaction` share a pinned
 * connection and serialize. Single-connection backends (better-sqlite3, Bun sqlite, D1) stay correct
 * but always serialize.
 *
 * An enclosing `withContext` scopes pool calls (`security` filters apply), which is why they take no
 * per-call `context` option (unlike `withQuerier`/`transaction`).
 *
 * Pool calls take the entity-as-argument form only; the `{ $entity }` form needs a querier.
 *
 * @typeParam Q - Querier implementation returned from the pool.
 * @typeParam D - Concrete dialect class held by the pool.
 */
export interface QuerierPool<
  Q extends Querier = Querier,
  D extends AbstractDialect = AbstractDialect,
> extends UniversalQuerier {
  /**
   * Database dialect instance (single source of truth for dialect id and SQL/NoSQL behavior).
   */
  readonly dialect: D;

  /**
   * extra options
   */
  readonly extra?: ExtraOptions;

  /**
   * Default connection for application queries, transactions, and anything that should use the pool's primary URL.
   */
  getQuerier: () => Promise<Q>;

  /**
   * When omitted, migrations use {@link getQuerier} - same type (`Q`), same dialect, often the same physical connection
   * (e.g. `:memory:` or a single remote URL). When set, **DDL and the migration journal** use this handle instead so they
   * can target another server while the app keeps using the replica (LibSQL `file:` + `syncUrl`). Call sites use
   * `acquireQuerierForMigrations` from `uql-orm/migrate`.
   */
  getMigrationQuerier?: () => Promise<Q>;

  /**
   * get a querier from the pool and run the given callback inside a transaction.
   */
  transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions & PoolRunOptions): Promise<T>;

  /**
   * get a querier from the pool, run the given callback, and release the querier.
   */
  withQuerier<T>(callback: (querier: Q) => Promise<T>, opts?: PoolRunOptions): Promise<T>;

  /**
   * end the pool.
   */
  end(): Promise<void>;
}

/**
 * SQL pool surface: adds the raw-SQL executors of {@link SqlQuerier} (`all`/`run`), with the same
 * connection-per-call semantics as the {@link QuerierPool} read helpers (see that doc for the
 * parallelism model and its single-connection caveat).
 *
 * Raw `all`/`run` bypass query generation, so they are **not** scoped by `security` filters/context.
 */
export interface SqlQuerierPool<Q extends SqlQuerier = SqlQuerier, D extends AbstractSqlDialect = AbstractSqlDialect>
  extends QuerierPool<Q, D>, Pick<SqlQuerier, 'all' | 'run'> {}

/** Dialect class used by pool `P` (when `P` is a {@link QuerierPool}). */
// oxlint-disable-next-line typescript/no-explicit-any -- conditional type extraction - `any` is required to match all pool instantiations
export type QuerierPoolDialect<P> = P extends QuerierPool<any, infer D> ? D : never;

/** Querier type produced by pool `P`. */
// oxlint-disable-next-line typescript/no-explicit-any -- conditional type extraction - `any` is required to match all pool instantiations
export type QuerierPoolQuerier<P> = P extends QuerierPool<infer Q, any> ? Q : never;

/**
 * Represents a high-compatibility SQL pool shim for Node.js integrations (e.g., express-session).
 */
export interface SqlPoolCompat {
  /**
   * Standardized query executor compatible with pg, mysql2, etc.
   */
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;

  /**
   * Event listener support for common pool events.
   */
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}
