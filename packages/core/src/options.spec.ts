import { getDefaultQuerier, getDefaultQuerierPool, setDefaultQuerierPool } from './options';
import { User } from './test/index';
import { Querier } from './type/index';

describe('options', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log');
  });

  it('getDefaultQuerierPool unset', () => {
    expect(() => getDefaultQuerierPool()).toThrow('A default querier-pool has to be set first');
  });

  it('getDefaultQuerier', async () => {
    const querierMock = {} as Querier;

    setDefaultQuerierPool({
      getQuerier: async () => querierMock,
      end: async () => {},
    });

    const querier1 = await getDefaultQuerierPool().getQuerier();
    expect(querier1).toBe(querierMock);

    const querier2 = await getDefaultQuerier();
    expect(querier2).toBe(querierMock);

    expect(getDefaultQuerierPool()).toBe(getDefaultQuerierPool());
  });
});
