import { describe, expect, it, vi } from 'vitest';
import { MongoDialect } from '../mongo/mongoDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import type { Querier } from '../type/index.js';
import { acquireQuerierForMigrations, withMongoQuerierForMigrations } from './acquireQuerierForMigrations.js';

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

  it('hands a MongoDB querier to the task and releases it', async () => {
    const querier = { db: {}, release: vi.fn() } as unknown as Querier;
    const pool = createMockQuerierPool(new MongoDialect(), vi.fn().mockResolvedValue(querier));

    expect(await withMongoQuerierForMigrations(pool, 'Test', async (q) => q)).toBe(querier);
    expect(querier.release).toHaveBeenCalledTimes(1);
  });

  it('refuses a querier with no MongoDB handle, and still releases it', async () => {
    const querier = { release: vi.fn() } as unknown as Querier;
    const pool = createMockQuerierPool(new MongoDialect(), vi.fn().mockResolvedValue(querier));

    await expect(withMongoQuerierForMigrations(pool, 'Test', async () => {})).rejects.toThrow(
      'Test requires a MongoDB querier',
    );
    expect(querier.release).toHaveBeenCalledTimes(1);
  });
});
