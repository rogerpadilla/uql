import type { Dialect, ExtraOptions, Querier, QuerierPool } from 'nukak/type';

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
