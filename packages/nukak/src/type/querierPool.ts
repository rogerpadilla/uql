import { Querier, QuerierLogger } from './querier';

/**
 * querier pool.
 */
export type QuerierPool<Q extends Querier = Querier> = {
  /**
   * logger function to print debug messages.
   */
  logger?: QuerierLogger;

  /**
   * get a querier from the pool.
   */
  getQuerier: () => Promise<Q>;

  /**
   * end the pool.
   */
  end(): Promise<void>;
};
