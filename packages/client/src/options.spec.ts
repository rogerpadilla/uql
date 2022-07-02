import { User } from '@uql/core/test';
import { getQuerier, getQuerierPool, setQuerierPool } from './options';
import { GenericClientRepository, HttpQuerier } from './querier';
import { ClientQuerierPool } from './type/clientQuerierPool';

describe('options', () => {
  it('default getQuerier', () => {
    const querier = getQuerier();
    expect(querier).toBeInstanceOf(HttpQuerier);
  });

  it('default querierPool', () => {
    expect(getQuerierPool()).toBeDefined();
  });

  it('custom querierPool', () => {
    const querierMock = new HttpQuerier('/');

    const querierPool: ClientQuerierPool = {
      getQuerier: () => querierMock,
    };

    setQuerierPool(querierPool);

    const querier1 = getQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = getQuerier();
    expect(querier2).toBe(querierMock);

    const repository1 = querier2.getRepository(User);
    expect(repository1).toBeInstanceOf(GenericClientRepository);

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
