import { describe, expect, it, vi } from 'vitest';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import { MongoDialect } from './mongoDialect.js';
import { withMongoQuerierForMigrations } from './mongoQuerier.js';

describe('withMongoQuerierForMigrations', () => {
  it('should hand a MongoDB querier to the task and release it', async () => {
    const querier = { db: {}, release: vi.fn() };
    const pool = createMockQuerierPool(new MongoDialect(), vi.fn().mockResolvedValue(querier));

    expect(await withMongoQuerierForMigrations(pool, 'Test', async (q) => q)).toBe(querier);
    expect(querier.release).toHaveBeenCalledTimes(1);
  });

  it('should refuse a querier with no MongoDB handle, and still releases it', async () => {
    const querier = { release: vi.fn() };
    const pool = createMockQuerierPool(new MongoDialect(), vi.fn().mockResolvedValue(querier));

    await expect(withMongoQuerierForMigrations(pool, 'Test', async () => {})).rejects.toThrow(
      'Test requires a MongoDB querier',
    );
    expect(querier.release).toHaveBeenCalledTimes(1);
  });
});
