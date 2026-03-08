import { createClient } from '@libsql/client';
import { describe, expect, it, vi } from 'vitest';
import { LibsqlQuerier } from './libsqlQuerier.js';
import { LibsqlQuerierPool } from './libsqlQuerierPool.js';

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

describe('LibsqlQuerierPool', () => {
  it('getQuerier', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    const querier = await pool.getQuerier();
    expect(querier).toBeInstanceOf(LibsqlQuerier);
    expect(createClient).toHaveBeenCalledWith(config);
  });

  it('end', async () => {
    const config = { url: ':memory:' };
    const pool = new LibsqlQuerierPool(config);
    await pool.end();
    expect(pool.client.close).toHaveBeenCalled();
  });
});
