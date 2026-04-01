import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type { Querier, QuerierPool, TransactionOptions } from '../type/index.js';

/**
 * Minimal {@link QuerierPool} for tests. Requires `dialect` so shapes stay aligned with {@link Config.pool}.
 */
export function createMockQuerierPool<Q extends Querier>(
  dialect: AbstractDialect,
  getQuerier: () => Promise<Q>,
): QuerierPool<Q, AbstractDialect> {
  return {
    dialect,
    getQuerier,
    async transaction<T>(callback: (querier: Q) => Promise<T>, _opts?: TransactionOptions): Promise<T> {
      const querier = await getQuerier();
      return callback(querier);
    },
    async withQuerier<T>(callback: (querier: Q) => Promise<T>): Promise<T> {
      const querier = await getQuerier();
      try {
        return await callback(querier);
      } finally {
        await querier.release();
      }
    },
    async end() {},
  };
}
