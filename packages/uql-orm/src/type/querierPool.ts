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
   * get a querier from the pool.
   */
  getQuerier: () => Promise<Q>;

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
