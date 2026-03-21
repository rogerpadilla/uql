import type { AbstractDialect } from '../dialect/index.js';
import type { Dialect, ExtraOptions, Querier, QuerierPool, TransactionOptions } from '../type/index.js';

export abstract class AbstractQuerierPool<D extends AbstractDialect, Q extends Querier> implements QuerierPool<Q> {
  constructor(
    readonly dialectInstance: D,
    readonly extra?: ExtraOptions,
  ) {}

  get dialect(): Dialect {
    return this.dialectInstance.dialect;
  }

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
