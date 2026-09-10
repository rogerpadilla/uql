import { createPool } from 'mariadb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MariadbQuerier } from './mariadbQuerier.js';
import { MariadbQuerierPool } from './mariadbQuerierPool.js';

const mockPoolInstance = {
  getConnection: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('mariadb', () => {
  return {
    createPool: vi.fn().mockImplementation(() => mockPoolInstance),
  };
});

describe('MariadbQuerierPool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getQuerier', async () => {
    const pool = new MariadbQuerierPool({ host: '0.0.0.0' });
    const querier = await pool.getQuerier();
    expect(querier).toBeInstanceOf(MariadbQuerier);
  });

  it('end', async () => {
    const pool = new MariadbQuerierPool({ host: '0.0.0.0' });
    await pool.end();
    expect(mockPoolInstance.end).toHaveBeenCalled();
  });

  /** `bigIntAsNumber` rounds past 2^53; the querier decodes exactly instead. */
  it('leaves BIGINT for the querier to decode', () => {
    new MariadbQuerierPool({ host: '0.0.0.0' });

    expect(createPool).toHaveBeenCalledWith({ host: '0.0.0.0' });
  });

  it('wires the pool error handler', () => {
    new MariadbQuerierPool({ host: '0.0.0.0' });

    expect(mockPoolInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
