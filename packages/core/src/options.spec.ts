import { User } from '@uql/core/test';
import { Querier } from '@uql/core/type';
import { getQuerier, getDefaultQuerierPool, getRepository, setDefaultQuerierPool } from './options';

describe('options', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log');
  });

  it('getDefaultQuerierPool unset', () => {
    expect(() => getDefaultQuerierPool()).toThrow('A default querier-pool has to be set first');
  });

  it('getQuerier', async () => {
    const querierMock = {} as Querier;

    setDefaultQuerierPool({
      getQuerier: async () => querierMock,
      end: async () => {},
    });

    const querier1 = await getDefaultQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getQuerier();
    expect(querier2).toBe(querierMock);

    const repository = getRepository(User, querier1);

    expect(repository).toBeDefined();

    expect(getDefaultQuerierPool()).toBe(getDefaultQuerierPool());
  });
});
