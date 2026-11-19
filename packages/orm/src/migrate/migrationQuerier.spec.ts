import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier } from '../test/mockQuerier.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import { withSqlQuerierForMigrations } from './migrationQuerier.js';

describe('withSqlQuerierForMigrations', () => {
  it("should run on the pool's migration querier, and release it", async () => {
    const migration = createMockQuerier({ all: vi.fn(), run: vi.fn(), dialect: new PostgresDialect() });
    const getQuerier = vi.fn();
    const pool = createMockQuerierPool(new PostgresDialect(), getQuerier, async () => migration);

    const ran = await withSqlQuerierForMigrations(pool, 'Migrator', async (querier) => querier === migration);

    expect(ran).toBe(true);
    expect(getQuerier).not.toHaveBeenCalled();
    expect(migration.release).toHaveBeenCalledTimes(1);
  });

  it('should refuse a querier with no SQL, and release it', async () => {
    const querier = createMockQuerier();
    const pool = createMockQuerierPool(new PostgresDialect(), async () => querier);

    await expect(withSqlQuerierForMigrations(pool, 'Migrator', async () => 'ran')).rejects.toThrow(
      'Migrator requires a SQL-based querier',
    );
    expect(querier.release).toHaveBeenCalledTimes(1);
  });
});
