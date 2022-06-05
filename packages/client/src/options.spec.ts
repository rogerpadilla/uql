import { User } from '@uql/core/test';
import { getQuerier, getDefaultQuerierPool, getRepository, setDefaultQuerierPool } from './options';
import { GenericClientRepository, HttpQuerier } from './querier/index';
import { ClientQuerier } from './type/index';
import { ClientQuerierPool } from './type/clientQuerierPool';

describe('options', () => {
  it('default getQuerier', () => {
    const querier = getQuerier();
    expect(querier).toBeInstanceOf(HttpQuerier);
  });

  it('default querierPool', () => {
    expect(getDefaultQuerierPool()).toBeDefined();
  });

  it('custom querierPool', () => {
    const querierMock = {} as ClientQuerier;

    const querierPool: ClientQuerierPool = {
      getQuerier: () => querierMock,
    };

    setDefaultQuerierPool(querierPool);

    const querier1 = getDefaultQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = getQuerier();
    expect(querier2).toBe(querierMock);

    expect(getRepository(User)).toBeInstanceOf(GenericClientRepository);
    expect(getRepository(User, querier1)).toBeInstanceOf(GenericClientRepository);

    expect(getDefaultQuerierPool()).toBe(getDefaultQuerierPool());
  });
});
