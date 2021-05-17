import { User } from '@uql/core/test';
import { getOptions, getQuerier, getQuerierPool, getRepository, setOptions } from './options';
import { ClientQuerier, UqlClientOptions } from './type';

describe('options', () => {
  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', async () => {
    expect(getOptions()).toBeDefined();

    const repository = await getRepository(User);
    expect(repository).toBeDefined();
  });

  it('setOptions', () => {
    const opts: UqlClientOptions = {
      querierPool: {
        getQuerier: async () => undefined,
      },
    };

    setOptions(opts);

    expect(getOptions()).toEqual(opts);

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
    });
  });

  it('getQuerier', async () => {
    const querierMock = {} as ClientQuerier;

    setOptions({
      querierPool: {
        getQuerier: async () => querierMock,
      },
    });

    const querier1 = await getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getQuerier();
    expect(querier2).toBe(querierMock);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
