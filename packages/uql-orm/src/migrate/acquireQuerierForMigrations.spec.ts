import { describe, expect, it, vi } from 'vitest';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import type { Querier } from '../type/index.js';
import { acquireQuerierForMigrations } from './acquireQuerierForMigrations.js';

describe('acquireQuerierForMigrations', () => {
  it('prefers getMigrationQuerier when present', async () => {
    const fromMigration = { release: vi.fn() } as unknown as Querier;
    const fromDefault = { release: vi.fn() } as unknown as Querier;
    const getQuerier = vi.fn().mockResolvedValue(fromDefault);
    const getMigrationQuerier = vi.fn().mockResolvedValue(fromMigration);
    const pool = createMockQuerierPool(new PostgresDialect(), getQuerier, { getMigrationQuerier });

    const q = await acquireQuerierForMigrations(pool);

    expect(q).toBe(fromMigration);
    expect(getMigrationQuerier).toHaveBeenCalledTimes(1);
    expect(getQuerier).not.toHaveBeenCalled();
  });

  it('falls back to getQuerier', async () => {
    const fromDefault = { release: vi.fn() } as unknown as Querier;
    const getQuerier = vi.fn().mockResolvedValue(fromDefault);
    const pool = createMockQuerierPool(new PostgresDialect(), getQuerier);

    const q = await acquireQuerierForMigrations(pool);

    expect(q).toBe(fromDefault);
    expect(getQuerier).toHaveBeenCalledTimes(1);
  });
});
