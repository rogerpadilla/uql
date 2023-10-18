import { ExtraOptions, Querier } from './querier.js';

/**
 * querier pool.
 */
export type QuerierPool<Q extends Querier = Querier> = {
  /**
   * extra options
   */
  readonly extra?: ExtraOptions;

  /**
   * get a querier from the pool.
   */
  getQuerier: () => Promise<Q>;

  /**
   * Automatically wraps the given callback inside a transaction, and auto-releases the querier after running.
   * @param callback the function to execute inside the transaction context.
   */
  transaction<T>(callback: (querier: Querier) => Promise<T>): Promise<T>;

  /**
   * end the pool.
   */
  end(): Promise<void>;
};
