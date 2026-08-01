import type { AbstractDialect } from '../dialect/abstractDialect.js';
import { AbstractQuerierPool } from '../querier/index.js';
import type { Querier, QuerierPool } from '../type/index.js';

export type CreateMockQuerierPoolOptions<Q extends Querier> = {
  getMigrationQuerier?: () => Promise<Q>;
};

/**
 * Minimal {@link QuerierPool} for tests. Extends {@link AbstractQuerierPool} so the read convenience
 * methods (`findMany`, `count`, ...) and the real `withQuerier`/`transaction` come for free: only
 * acquisition is mocked, so specs exercise the lifecycle the ORM actually runs.
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

  override async end(): Promise<void> {}
}

export function createMockQuerierPool<Q extends Querier>(
  dialect: AbstractDialect,
  getQuerier: () => Promise<Q>,
  options?: CreateMockQuerierPoolOptions<Q>,
): QuerierPool<Q, AbstractDialect> {
  return new MockQuerierPool(dialect, getQuerier, options?.getMigrationQuerier);
}
