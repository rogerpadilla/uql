import { getQuerier, getQuerierPool, setQuerierPool } from './options';
import { User } from './test';
import { Querier, Repository } from './type';

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
