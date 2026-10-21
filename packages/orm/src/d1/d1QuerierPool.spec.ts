import { describe, expect, it, vi } from 'vitest';
import { D1Querier, type D1Queryable } from './d1Querier.js';
import { D1QuerierPool } from './d1QuerierPool.js';

describe('D1QuerierPool', () => {
  /** A session from `env.DB.withSession()`, as a read-replicated database is read, answers what a binding does. */
  it('should hand every querier the binding or session it was given', async () => {
    const session = { prepare: vi.fn(), batch: vi.fn() } satisfies D1Queryable;

    const querier = await new D1QuerierPool(session).getQuerier();

    expect(querier).toBeInstanceOf(D1Querier);
    expect(querier.db).toBe(session);
  });

  it('should end without touching the binding', async () => {
    const session = { prepare: vi.fn(), batch: vi.fn() } satisfies D1Queryable;

    await expect(new D1QuerierPool(session).end()).resolves.toBeUndefined();
    expect(session.prepare).not.toHaveBeenCalled();
  });
});
