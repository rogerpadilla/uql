import { getOptions, uql } from '@uql/core/options';
import { QuerierPool } from '@uql/core/type';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

describe('querierPool', () => {
  let querierPool: QuerierPool;

  beforeEach(() => {
    uql({
      querierPool: new Sqlite3QuerierPool({
        filename: ':memory:',
      }),
    });

    querierPool = getOptions().querierPool;
  });

  afterEach(async () => {
    await querierPool.end();
  });

  it('getQuerier', async () => {
    const querier1 = await querierPool.getQuerier();
    expect(querier1).toBeDefined();
    const querier2 = await querierPool.getQuerier();
    expect(querier2).toBeDefined();
    expect(querier1).toBe(querier2);
  });
});
