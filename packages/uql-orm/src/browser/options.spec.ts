import { describe, expect, it } from 'vitest';
import { getQuerier, getQuerierPool, setQuerierPool } from './options.js';
import { HttpQuerier } from './querier/index.js';
import type { ClientQuerierPool } from './type/clientQuerierPool.js';

describe('options', () => {
  it('should hand out an HTTP querier by default', () => {
    const querier = getQuerier();
    expect(querier).toBeInstanceOf(HttpQuerier);
  });

  it('should have a pool by default', () => {
    expect(getQuerierPool()).toBeDefined();
  });

  it('should hand out the querier of a pool that was set', () => {
    const querierMock = new HttpQuerier('/');

    const pool: ClientQuerierPool = {
      getQuerier: () => querierMock,
    };

    setQuerierPool(pool);

    const querier1 = getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = getQuerier();
    expect(querier2).toBe(querierMock);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
