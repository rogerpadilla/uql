import { describe, expect, it } from 'vitest';
import { PostgresDialect } from './dialect/index.js';
import { getQuerier, getQuerierPool, setQuerierPool } from './options.js';
import { createMockQuerierPool } from './test/mockQuerierPool.js';
import type { Querier } from './type/index.js';

describe('options', () => {
  it('getQuerierPool unset', () => {
    expect(() => getQuerierPool()).toThrow('A default querier-pool has to be set first');
  });

  it('getQuerier', async () => {
    const querierMock = {} as Querier;

    setQuerierPool(createMockQuerierPool(new PostgresDialect(), async () => querierMock));

    const querier1 = await getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getQuerier();
    expect(querier2).toBe(querierMock);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
