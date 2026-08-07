import { Pool } from '@neondatabase/serverless';
import type { CustomTypesConfig } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { NeonQuerier } from './neonQuerier.js';
import { NeonQuerierPool } from './neonQuerierPool.js';

const mockPoolInstance = {
  connect: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('@neondatabase/serverless', () => {
  return {
    Pool: vi.fn().mockImplementation(function (this: any) {
      return mockPoolInstance;
    }),
    // Neon ships its own copy of node-postgres's type registry, and the pool passes it to
    // `numericTypes` so that this entry never has to import `pg` on a runtime that has no such peer.
    types: { builtins: { INT8: 20, FLOAT8: 701 }, getTypeParser: () => String },
  };
});

describe('NeonQuerierPool', () => {
  it('getQuerier', async () => {
    const config = { connectionString: 'postgres://' };
    const pool = new NeonQuerierPool(config);
    const querier = await pool.getQuerier();
    expect(querier).toBeInstanceOf(NeonQuerier);
  });

  it('decodes wide integers with Neon’s own type registry, not `pg`’s', () => {
    new NeonQuerierPool({ connectionString: 'postgres://' });
    const [{ types }] = vi.mocked(Pool).mock.calls[0] as [{ types: CustomTypesConfig }];
    expect(types.getTypeParser(20, 'text')).toBe(Number);
    expect(types.getTypeParser(701, 'text')).toBe(Number);
    // Anything else, and anything not in text format, is the driver's own business.
    expect(types.getTypeParser(25, 'text')).toBe(String);
    expect(types.getTypeParser(20, 'binary')).toBe(String);
  });

  it('end', async () => {
    const config = { connectionString: 'postgres://' };
    const pool = new NeonQuerierPool(config);
    await pool.end();
    expect(mockPoolInstance.end).toHaveBeenCalled();
  });
});
