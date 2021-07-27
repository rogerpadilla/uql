import { User } from '@uql/core/test';
import { Querier } from '@uql/core/type';
import { getOptions, getQuerier, getQuerierPool, getRepository, setOptions } from './options';

describe('options', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log');
  });

  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(getOptions()).toEqual({});
  });

  it('setOptions', () => {
    const logger = jest.fn();

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
    });

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
    });
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
