import type { AbstractDialect } from '../dialect/index.js';
import type { ExtraOptions, Querier, TransactionOptions } from './querier.js';

/**
 * Querier pool. Read the dialect id via `pool.dialect.dialectName` (see {@link AbstractDialect.dialectName}); queriers expose the same on `querier.dialect`.
 *
 * @typeParam Q - Querier implementation returned from the pool.
 * @typeParam D - Concrete dialect class held by the pool.
 */
export type QuerierPool<Q extends Querier = Querier, D extends AbstractDialect = AbstractDialect> = {
  /**
   * Database dialect instance (single source of truth for dialect id and SQL/NoSQL behavior).
   */
  readonly dialect: D;

  /**
   * extra options
   */
  readonly extra?: ExtraOptions;

  /**
   * Default connection for application queries, transactions, and anything that should use the pool’s primary URL.
   */
  getQuerier: () => Promise<Q>;

  /**
   * When omitted, migrations use {@link getQuerier} — same type (`Q`), same dialect, often the same physical connection
   * (e.g. `:memory:` or a single remote URL). When set, **DDL and the migration journal** use this handle instead so they
   * can target another server while the app keeps using the replica (LibSQL `file:` + `syncUrl`). Call sites use
   * `acquireQuerierForMigrations` from `uql-orm/migrate`.
   */
  getMigrationQuerier?: () => Promise<Q>;

  /**
   * get a querier from the pool and run the given callback inside a transaction.
   */
  transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions): Promise<T>;

  /**
   * get a querier from the pool, run the given callback, and release the querier.
   */
  withQuerier<T>(callback: (querier: Q) => Promise<T>): Promise<T>;

  /**
   * end the pool.
   */
  end(): Promise<void>;
};

/** Dialect class used by pool `P` (when `P` is a {@link QuerierPool}). */
export type QuerierPoolDialect<P> = P extends QuerierPool<any, infer D> ? D : never;

/** Querier type produced by pool `P`. */
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
