import { clearOptions, setOptions } from '../options';
import { getQuerier } from './querierPool';

describe('querierPool', () => {
  beforeEach(() => {
    setOptions({
      datasource: {
        driver: 'pg',
        host: '0.0.0.0',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test',
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
  });
});
