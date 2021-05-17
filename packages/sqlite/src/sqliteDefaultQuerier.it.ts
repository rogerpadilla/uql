import { setOptions, getQuerier, getQuerierPool } from '@uql/core/options';
import { BaseRepository } from '@uql/core/querier';
import { User } from '@uql/core/test';
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
    expect(querier1.getRepository(User)).toBeInstanceOf(BaseRepository);
    const querier2 = await querierPool.getQuerier();
    expect(querier2).toBe(querier1);
    expect(querierPool).toBe(getQuerierPool());
  });
});
