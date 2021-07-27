import { Logger } from './options';
import { Querier } from './querier';
import { QueryUpdateResult } from './query';

/**
 * querier connection.
 */
export type QuerierPoolConnection = {
  /**
   * find query.
   * @param query the query
   */
  all<T>(query: string): Promise<T[]>;
  /**
   * insert/update/delete query.
   * @param query the query
   */
  run(query: string): Promise<QueryUpdateResult>;
  /**
   * release the connection to the pool.
   */
  release(): Promise<void>;
  /**
   * end the connection.
   */
  end(): Promise<void>;
};

/**
 * querier pool.
 */
export type QuerierPool<Q extends Querier = Querier> = {
  /**
   * logger function to print debug messages.
   */
  logger?: Logger;
  /**
   * get a querier from the pool.
   */
  getQuerier: () => Promise<Q>;
  /**
   * end the pool.
   */
  end(): Promise<void>;
};
