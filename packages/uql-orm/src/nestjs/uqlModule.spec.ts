import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import * as options from '../options.js';
import type { Querier, QuerierPool } from '../type/index.js';
import { UQL_QUERIER_POOL, UqlModule } from './uqlModule.js';

vi.mock('../options.js');

describe('UqlModule', () => {
  const pool = {
    getQuerier: vi.fn().mockResolvedValue({} as Querier),
    end: vi.fn(),
  } as unknown as QuerierPool;

  it('provides the pool via the injection token and sets the default pool', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UqlModule.forRoot({ pool })],
    }).compile();

    expect(moduleRef.get<QuerierPool>(UQL_QUERIER_POOL)).toBe(pool);
    expect(options.setQuerierPool).toHaveBeenCalledWith(pool);
  });

  it('registers globally by default and honors global: false', () => {
    expect(UqlModule.forRoot({ pool }).global).toBe(true);
    expect(UqlModule.forRoot({ pool, global: false }).global).toBe(false);
  });
});
