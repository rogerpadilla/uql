import type { AbstractDialect } from '../dialect/abstractDialect.js';
import { AbstractQuerierPool } from '../querier/index.js';
import type { Querier, QuerierPool } from '../type/index.js';

export type CreateMockQuerierPoolOptions<Q extends Querier> = {
  getMigrationQuerier?: () => Promise<Q>;
};

/**
 * Minimal {@link QuerierPool} for tests. Extends {@link AbstractQuerierPool} so the read convenience
 * methods (`findMany`, `count`, ...) come for free, and only overrides acquisition and the simplified
 * `transaction` (runs the callback without a real begin/commit, which the migration tests rely on).
 */
class MockQuerierPool<Q extends Querier> extends AbstractQuerierPool<Q, AbstractDialect> {
  // Kept as the exact functions passed in (not wrapped), so tests can re-stub them (`pool.getQuerier.mockResolvedValue(...)`).
  override readonly getQuerier: () => Promise<Q>;
  readonly getMigrationQuerier?: () => Promise<Q>;

  constructor(dialect: AbstractDialect, getQuerier: () => Promise<Q>, getMigrationQuerier?: () => Promise<Q>) {
    super(dialect);
    this.getQuerier = getQuerier;
    this.getMigrationQuerier = getMigrationQuerier;
  }

  override async transaction<T>(callback: (querier: Q) => Promise<T>): Promise<T> {
    const querier = await this.getQuerier();
    return callback(querier);
  }

  override async end(): Promise<void> {}
}

export function createMockQuerierPool<Q extends Querier>(
  dialect: AbstractDialect,
  getQuerier: () => Promise<Q>,
  options?: CreateMockQuerierPoolOptions<Q>,
): QuerierPool<Q, AbstractDialect> {
  return new MockQuerierPool(dialect, getQuerier, options?.getMigrationQuerier);
}
