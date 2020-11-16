import { createSpec } from 'uql/test';
import { SqlQuerierPoolSpec } from 'uql/querier/sqlQuerierPoolSpec';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

export class Sqlite3QuerierPoolSpec extends SqlQuerierPoolSpec {
  readonly primaryKeyType = 'INTEGER PRIMARY KEY AUTOINCREMENT';

  constructor() {
    super(new Sqlite3QuerierPool(':memory:'));
  }
}

createSpec(new Sqlite3QuerierPoolSpec());
