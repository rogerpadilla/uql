import { createSpec } from 'uql/test.util';
import { SqlQuerierSpec } from '../sqlQuerierSpec';
import MySql2QuerierPool from './mysql2QuerierPool';

export class MySqlQuerierSpec extends SqlQuerierSpec {
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

createSpec(new MySqlQuerierSpec());
