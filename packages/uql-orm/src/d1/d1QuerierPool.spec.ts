import { describe, expect, it } from 'vitest';
import type { D1Database } from './d1Querier.js';
import { D1Querier } from './d1Querier.js';
import { D1QuerierPool } from './d1QuerierPool.js';

describe('D1QuerierPool', () => {
  it('getQuerier', async () => {
    const db = {} as D1Database;
    const pool = new D1QuerierPool(db);
    const querier = await pool.getQuerier();
    expect(querier).toBeInstanceOf(D1Querier);
    expect(querier.db).toBe(db);
  });

  it('end', async () => {
    const db = {} as D1Database;
    const pool = new D1QuerierPool(db);
    await expect(pool.end()).resolves.toBeUndefined();
  });
});
