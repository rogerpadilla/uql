import { QuerierPool } from './querierPool';

export type UqlOptions<T extends QuerierPool = QuerierPool> = {
  /**
   * the default querier-pool instance.
   */
  querierPool: T;
};
