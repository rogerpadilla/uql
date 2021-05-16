import { setOptions } from '@uql/core';
import { getQuerier, getQuerierPool } from '@uql/core/querier';
import { Querier } from '../type';

describe('querierPool', () => {
  afterEach(async () => {
    setOptions(undefined);
  });

  it('getQuerierPool unset', async () => {
    await expect(async () => getQuerierPool()).rejects.toThrow(`'querierPool' has to be passed via 'setOptions'`);
  });

  it('getQuerier unset', async () => {
    await expect(async () => getQuerier()).rejects.toThrow(`'querierPool' has to be passed via 'setOptions'`);
  });

  it('getQuerier unset', async () => {
    const querierMock = { hasOpenTransaction: true } as Partial<Querier> as Querier;

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

    expect(getQuerierPool()).toBe(getQuerierPool());
  });
});
