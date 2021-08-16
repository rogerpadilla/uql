import { AbstractSqlQuerierSpec } from '@uql/core/querier/abstractSqlQuerier-spec';
import { createSpec } from '@uql/core/test';
import { Sqlite3QuerierPool } from './sqlite3QuerierPool';

class SqliteQuerierSpec extends AbstractSqlQuerierSpec {
  constructor() {
    super(new Sqlite3QuerierPool({ filename: ':memory:' }));
  }
}

createSpec(new SqliteQuerierSpec());
