import { getQuerier, getQuerierPool, setOptions } from '@uql/core';
import { QuerierPool } from '@uql/core/type';

import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

describe('querierPool', () => {
  let querierPool: QuerierPool;

  beforeEach(() => {
    setOptions({
      querierPool: new Sqlite3QuerierPool({
        filename: ':memory:',
      }),
    });

    querierPool = getQuerierPool();
  });

  afterEach(async () => {
    await querierPool.end();
  });

  it('getQuerier', async () => {
    const querier1 = await getQuerier();
    expect(querier1).toBeDefined();
    const querier2 = await querierPool.getQuerier();
    expect(querier2).toBeDefined();
    expect(querier1).toBe(querier2);
    expect(querierPool).toBe(getQuerierPool());
  });
});
