import type { Dialect, ExtraOptions, Querier } from './querier.js';

/**
 * querier pool.
 */
export type QuerierPool<Q extends Querier = Querier> = {
  /**
   * the database dialect.
   */
  readonly dialect: Dialect;

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
  transaction<T>(callback: (querier: Q) => Promise<T>): Promise<T>;

  /**
   * end the pool.
   */
  end(): Promise<void>;
};
