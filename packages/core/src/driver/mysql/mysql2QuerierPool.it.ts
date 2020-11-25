import { createSpec } from '../../test';
import { BaseSqlQuerierPoolIt } from '../baseSqlQuerierPoolIt';
import { MySql2QuerierPool } from './mysql2QuerierPool';

export class MySql2QuerierPoolSpec extends BaseSqlQuerierPoolIt {
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
