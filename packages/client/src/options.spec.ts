import { User } from '@uql/core/test';
import { getOptions, getQuerier, getQuerierPool, getRepository, setOptions } from './options';
import { BaseClientRepository, HttpQuerier } from './querier';
import { ClientQuerier, UqlClientOptions } from './type';

describe('options', () => {
  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(getOptions()).toBeDefined();
    const querier = getQuerier();
    expect(querier).toBeInstanceOf(HttpQuerier);
  });

  it('setOptions', () => {
    const opts: UqlClientOptions = {
      querierPool: {
        getQuerier: () => undefined,
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

  it('getQuerier', () => {
    const querierMock = {} as ClientQuerier;

    setOptions({
      querierPool: {
        getQuerier: () => querierMock,
      },
    });

    const querier1 = getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = getQuerier();
    expect(querier2).toBe(querierMock);

    expect(getRepository(User)).toBeInstanceOf(BaseClientRepository);
    expect(getRepository(User, querier1)).toBeInstanceOf(BaseClientRepository);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
