import type { Dialect, ExtraOptions, Querier, QuerierPool } from '../type/index.js';

export abstract class AbstractQuerierPool<Q extends Querier> implements QuerierPool<Q> {
  constructor(
    readonly dialect: Dialect,
    readonly extra?: ExtraOptions,
  ) {}

  /**
   * get a querier from the pool.
   */
  abstract getQuerier(): Promise<Q>;

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
