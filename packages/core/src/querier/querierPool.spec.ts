// eslint-disable-next-line import/no-named-as-default
import { PgQuerierPool } from '../driver/postgres';
import { clearOptions, setOptions } from '../options';
import { getQuerier, getQuerierPool } from './querierPool';

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

  it('getQuerierPool invalid driver', async () => {
    const querier1 = await getQuerier();
    expect(querier1).toBeDefined();
    const querier2 = await getQuerier();
    expect(querier2).toBeDefined();
  });
});
