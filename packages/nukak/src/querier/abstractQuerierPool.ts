import type { ExtraOptions, Querier, QuerierPool } from 'nukak/type';

export abstract class AbstractQuerierPool<Q extends Querier> implements QuerierPool<Q> {
  constructor(readonly extra?: ExtraOptions) {}

  /**
   * get a querier from the pool.
   */
  abstract getQuerier(): Promise<Q>;

  /**
   * end the pool.
   */
  abstract end(): Promise<void>;

  /**
   * Automatically wraps the given callback inside a transaction, and auto-releases the querier after running.
   * @param callback the function to execute inside the transaction context.
   */
  async transaction<T>(callback: (querier: Querier) => Promise<T>) {
    const querier = await this.getQuerier();
    const res = await querier.transaction<T>(() => callback(querier));
    return res;
  }
}
