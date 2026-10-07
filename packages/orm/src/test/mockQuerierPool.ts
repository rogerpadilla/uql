import type { AbstractDialect } from '../dialect/abstractDialect.js';
import { AbstractQuerierPool } from '../querier/index.js';
import type { Querier, QuerierPool } from '../type/index.js';

/**
 * Minimal {@link QuerierPool} for tests, whose read helpers and `withQuerier`/`transaction` are the real
 * ones: only acquisition is mocked, through the functions passed in as they are, so a spec can re-stub them.
 */
class MockQuerierPool<Q extends Querier, D extends AbstractDialect> extends AbstractQuerierPool<Q, D> {
  override readonly getQuerier: () => Promise<Q>;
  readonly getMigrationQuerier?: () => Promise<Q>;

  constructor(dialect: D, getQuerier: () => Promise<Q>, getMigrationQuerier?: () => Promise<Q>) {
    super(dialect);
    this.getQuerier = getQuerier;
    this.getMigrationQuerier = getMigrationQuerier;
  }

  override async end(): Promise<void> {}
}

export function createMockQuerierPool<Q extends Querier, D extends AbstractDialect>(
  dialect: D,
  getQuerier: () => Promise<Q>,
  options?: { getMigrationQuerier?: () => Promise<Q> },
): QuerierPool<Q, D> {
  return new MockQuerierPool(dialect, getQuerier, options?.getMigrationQuerier);
}
