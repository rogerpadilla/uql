import { getOptions, getQuerier, getQuerierPool, getRepository, isDebug, log, setOptions } from './options';
import { User } from './test';
import { Querier } from './type';

describe('options', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log');
    jest.spyOn(console, 'info');
  });

  afterEach(() => {
    setOptions(undefined);
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('getOptions unset', () => {
    expect(getOptions()).toEqual({
      logger: expect.any(Function),
    });

    expect(isDebug()).toBeFalsy();
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

    expect(isDebug()).toBe(true);

    log('hi', 'uql');
    expect(console.info).toBeCalledWith('hi', 'uql');
    expect(console.info).toBeCalledTimes(1);
    expect(console.log).toBeCalledTimes(0);

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: expect.any(Function),
    });
  });

  it('getQuerierPool unset', async () => {
    await expect(async () => getQuerierPool()).rejects.toThrow(`'querierPool' has to be passed via 'setOptions'`);
  });

  it('getQuerier unset', async () => {
    await expect(async () => getQuerier()).rejects.toThrow(`'querierPool' has to be passed via 'setOptions'`);
  });

  it('getQuerier', async () => {
    const querierMock = {} as Querier;

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

    const repository = getRepository(User, querier1);

    expect(repository).toBeDefined();

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
