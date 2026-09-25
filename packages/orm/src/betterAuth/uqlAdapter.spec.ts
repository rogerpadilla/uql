import { describe, expect, it, vi } from 'vitest';
import { D1SqliteDialect } from '../d1/d1SqliteDialect.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool } from '../test/index.js';
import { uqlAdapter } from './uqlAdapter.js';

describe('uqlAdapter', () => {
  it('should run a transaction where the engine has them', async () => {
    const pool = createMockQuerierPool(new PostgresDialect(), async () => createMockQuerier());
    const transaction = vi.spyOn(pool, 'transaction');

    await uqlAdapter(pool)({}).transaction(async () => undefined);

    expect(transaction).toHaveBeenCalledOnce();
  });

  it('should run the steps in order on D1, which has no transactions', async () => {
    const pool = createMockQuerierPool(new D1SqliteDialect(), async () => createMockQuerier());
    const transaction = vi.spyOn(pool, 'transaction');

    await uqlAdapter(pool)({}).transaction(async () => undefined);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('should refuse a created row it cannot read back', async () => {
    const pool = createMockQuerierPool(new PostgresDialect(), async () => createMockQuerier());
    const data = { name: 'Ada', email: 'ada@example.com', emailVerified: false };

    await expect(uqlAdapter(pool)({}).create({ model: 'user', data })).rejects.toThrow(
      "Better Auth inserted a 'user' row it cannot read back",
    );
  });
});
