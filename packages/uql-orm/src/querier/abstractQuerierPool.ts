import type { AbstractDialect } from '../dialect/index.js';
import type { ExtraOptions, Querier, QuerierPool, TransactionOptions } from '../type/index.js';

/**
 * Base pool: dialect id and behavior come only from the `dialect` instance (see {@link QuerierPool}).
 */
export abstract class AbstractQuerierPool<D extends AbstractDialect, Q extends Querier> implements QuerierPool<Q, D> {
  constructor(
    readonly dialect: D,
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
