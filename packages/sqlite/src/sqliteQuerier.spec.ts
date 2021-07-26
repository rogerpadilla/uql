import { BaseSqlQuerierSpec } from '@uql/core/querier/sqlQuerier-spec';
import { createSpec } from '@uql/core/test';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

class SqliteQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }
}

createSpec(new SqliteQuerierSpec());
