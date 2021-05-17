import { getLogger, getOptions, getQuerier, getQuerierPool, getRepository, setOptions } from './options';
import { User } from './test';
import { Querier, Repository, Type } from './type';

describe('options', () => {
  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(getOptions()).toEqual({
      logger: console.log,
    });
    expect(getLogger()).toBe(console.log);
  });

  it('setOptions', () => {
    setOptions({
      querierPool: undefined,
      logger: console.info,
      debug: true,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.info,
      debug: true,
    });
    expect(getLogger()).toBe(console.info);

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.log,
    });
  });

  it('getQuerierPool unset', async () => {
    await expect(async () => getQuerierPool()).rejects.toThrow(`'querierPool' has to be passed via 'setOptions'`);
  });

  it('getQuerier unset', async () => {
    await expect(async () => getQuerier()).rejects.toThrow(`'querierPool' has to be passed via 'setOptions'`);
  });

  it('getQuerier', async () => {
    const repositoryMock = {} as Repository<User>;

    const querierMock = {
      getRepository<E>(entity: Type<E>) {
        return repositoryMock;
      },
    } as Querier;

    setOptions({
      querierPool: {
        getQuerier: async () => querierMock,
        end: async () => {},
      },
    });

    const querier1 = await getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getQuerier();
    expect(querier2).toBe(querierMock);

    const repository = await getRepository(User);

    expect(repository).toBe(repositoryMock);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
