import { getOptions, getQuerier, getQuerierPool, getRepository, isLogging, log, setLogging, setOptions } from './options';
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

    expect(isLogging()).toBeFalsy();
  });

  it('setOptions', () => {
    const logger = jest.fn();

    setOptions({
      querierPool: undefined,
      logging: true,
      logger,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logging: true,
      logger,
    });

    expect(isLogging()).toBe(true);

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

  it('logging', () => {
    expect(isLogging()).toBeFalsy();
    setLogging(true);
    expect(isLogging()).toBe(true);
    setLogging(false);
    expect(isLogging()).toBe(false);
  });

  it('getQuerierPool unset', () => {
    expect(() => getQuerierPool()).toThrow(`'querierPool' has to be passed via 'setOptions'`);
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
