import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getQuerier, getQuerierPool, setQuerierPool } from './options.js';
import type { Querier } from './type/index.js';

describe('options', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log');
  });

  it('getQuerierPool unset', () => {
    expect(() => getQuerierPool()).toThrow('A default querier-pool has to be set first');
  });

  it('getQuerier', async () => {
    const querierMock = {} as Querier;

    setQuerierPool({
      getQuerier: async () => querierMock,
      end: async () => {},
      dialect: 'postgres',
      transaction: async (cb) => cb(querierMock),
    });

    const querier1 = await getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getQuerier();
    expect(querier2).toBe(querierMock);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
