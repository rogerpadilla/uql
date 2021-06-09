import { getOptions, getQuerier, getQuerierPool, getRepository, isDebug, log, setDebug, setOptions } from './options';
import { User } from './test';
import { Querier } from './type';

describe('options', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log');
  });

  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(getOptions()).toEqual({
      logger: expect.any(Function),
    });

    expect(isDebug()).toBeFalsy();
  });

  it('setOptions', () => {
    const logger = jest.fn();

    setOptions({
      querierPool: undefined,
      logger,
      debug: true,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger,
      debug: true,
    });

    expect(isDebug()).toBe(true);

    log('hi', 'uql');
    expect(logger).toBeCalledWith('hi', 'uql');
    expect(logger).toBeCalledTimes(1);
    expect(console.log).toBeCalledTimes(0);

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: expect.any(Function),
    });
  });

  it('debug', () => {
    expect(isDebug()).toBeFalsy();
    setDebug(true);
    expect(isDebug()).toBe(true);
    setDebug(false);
    expect(isDebug()).toBe(false);
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
