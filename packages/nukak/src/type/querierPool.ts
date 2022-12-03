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
   * end the pool.
   */
  end(): Promise<void>;
};
