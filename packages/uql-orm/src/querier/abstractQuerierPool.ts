import type { Dialect, ExtraOptions, Querier, QuerierPool, TransactionOptions } from '../type/index.js';

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
  async transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions): Promise<T> {
    const querier = await this.getQuerier();
    return querier.transaction(() => callback(querier), opts);
  }

  /**
   * get a querier from the pool, run the given callback, and release the querier.
   */
  async withQuerier<T>(callback: (querier: Q) => Promise<T>): Promise<T> {
    const querier = await this.getQuerier();
    try {
      return await callback(querier);
    } finally {
      await querier.release();
    }
  }

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;
}
