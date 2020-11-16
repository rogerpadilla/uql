import { createSpec } from 'uql/test/test.util';
import { SqlQuerierPoolSpec } from 'uql/querier/sqlQuerierPoolSpec';
import { MySql2QuerierPool } from './mysql2QuerierPool';

export class MySql2QuerierPoolSpec extends SqlQuerierPoolSpec {
  constructor() {
    super(
      new MySql2QuerierPool({
        host: '0.0.0.0',
        port: 3306,
        user: 'test',
        password: 'test',
        database: 'test',
      })
    );
  }
}

createSpec(new MySql2QuerierPoolSpec());
