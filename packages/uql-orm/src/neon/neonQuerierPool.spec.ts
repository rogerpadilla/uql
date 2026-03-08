import { describe, expect, it, vi } from 'vitest';
import { NeonQuerier } from './neonQuerier.js';
import { NeonQuerierPool } from './neonQuerierPool.js';

const mockPoolInstance = {
  connect: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@neondatabase/serverless', () => {
  return {
    Pool: vi.fn().mockImplementation(function (this: any) {
      return mockPoolInstance;
    }),
  };
});

describe('NeonQuerierPool', () => {
  it('getQuerier', async () => {
    const config = { connectionString: 'postgres://' };
    const pool = new NeonQuerierPool(config);
    const querier = await pool.getQuerier();
    expect(querier).toBeInstanceOf(NeonQuerier);
  });

  it('end', async () => {
    const config = { connectionString: 'postgres://' };
    const pool = new NeonQuerierPool(config);
    await pool.end();
    expect(mockPoolInstance.end).toHaveBeenCalled();
  });
});
