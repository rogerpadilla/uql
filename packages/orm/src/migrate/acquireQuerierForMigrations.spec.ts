import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import { acquireQuerierForMigrations } from './acquireQuerierForMigrations.js';

describe('acquireQuerierForMigrations', () => {
  it('should prefer getMigrationQuerier when present', async () => {
    const fromMigration = { release: vi.fn() };
    const fromDefault = { release: vi.fn() };
    const getQuerier = vi.fn().mockResolvedValue(fromDefault);
    const getMigrationQuerier = vi.fn().mockResolvedValue(fromMigration);
    const pool = createMockQuerierPool(new PostgresDialect(), getQuerier, { getMigrationQuerier });

    const q = await acquireQuerierForMigrations(pool);

    expect(q).toBe(fromMigration);
    expect(getMigrationQuerier).toHaveBeenCalledTimes(1);
    expect(getQuerier).not.toHaveBeenCalled();
  });

  it('should fall back to getQuerier', async () => {
    const fromDefault = { release: vi.fn() };
    const getQuerier = vi.fn().mockResolvedValue(fromDefault);
    const pool = createMockQuerierPool(new PostgresDialect(), getQuerier);

    const q = await acquireQuerierForMigrations(pool);

    expect(q).toBe(fromDefault);
    expect(getQuerier).toHaveBeenCalledTimes(1);
  });
});
