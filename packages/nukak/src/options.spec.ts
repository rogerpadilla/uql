import { getQuerier, getQuerierPool, setQuerierPool } from './options.js';
import { User } from './test/index.js';
import type { Querier, Repository } from './type/index.js';

describe('options', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log');
  });

  it('getQuerierPool unset', () => {
    expect(() => getQuerierPool()).toThrow('A default querier-pool has to be set first');
  });

  it('getQuerier', async () => {
    const repositoryMock = {} as Repository<User>;

    const querierMock = {
      getRepository<T>(entity: T) {
        return repositoryMock;
      },
    } as Querier;

    setQuerierPool({
      getQuerier: async () => querierMock,
      end: async () => {},
      transaction: async (callback: (querier: Querier) => void) => {
        return undefined;
      },
    });

    const querier1 = await getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getQuerier();
    expect(querier2).toBe(querierMock);

    const repository1 = await querier2.getRepository(User);
    expect(repository1).toBe(repositoryMock);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
