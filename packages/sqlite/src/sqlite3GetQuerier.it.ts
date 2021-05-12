import { getQuerier } from '@uql/core/querier';
import { clearOptions, setOptions } from '@uql/core/options';

describe('querierPool', () => {
  beforeEach(() => {
    setOptions({
      datasource: {
        driver: 'sqlite3',
        filename: ':memory:',
      },
    });
  });

  afterEach(() => {
    clearOptions();
  });

  it('getQuerier', async () => {
    const querier1 = await getQuerier();
    expect(querier1).toBeDefined();
    const querier2 = await getQuerier();
    expect(querier2).toBeDefined();
    expect(querier1).toBe(querier2);
  });
});
