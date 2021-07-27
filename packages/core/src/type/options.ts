import { QuerierPool } from './querierPool';

/**
 * logger function to print debug messages.
 */
export type Logger = (message: any, ...args: any[]) => any;

export type UqlOptions<T extends QuerierPool = QuerierPool> = {
  /**
   * the default querier-pool instance.
   */
  querierPool: T;
};
