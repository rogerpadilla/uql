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
   * get a querier from the pool and run the given callback inside a transaction.
   */
  async transaction<T>(callback: (querier: Q) => Promise<T>): Promise<T> {
    const querier = await this.getQuerier();
    return querier.transaction(() => callback(querier));
  }

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
