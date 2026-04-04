import type { AbstractDialect } from '../dialect/abstractDialect.js';
import type { Querier, QuerierPool, TransactionOptions } from '../type/index.js';

export type CreateMockQuerierPoolOptions<Q extends Querier> = {
  getMigrationQuerier?: () => Promise<Q>;
};

/**
 * Minimal {@link QuerierPool} for tests. Requires `dialect` so shapes stay aligned with {@link Config.pool}.
 */
export function createMockQuerierPool<Q extends Querier>(
  dialect: AbstractDialect,
  getQuerier: () => Promise<Q>,
  options?: CreateMockQuerierPoolOptions<Q>,
): QuerierPool<Q, AbstractDialect> {
  const pool: QuerierPool<Q, AbstractDialect> = {
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
  if (options?.getMigrationQuerier) {
    pool.getMigrationQuerier = options.getMigrationQuerier;
  }
  return pool;
}
