import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { createSpec } from '@uql/core/test';
import { SqliteQuerier } from './sqliteQuerier';

class SqliteQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(SqliteQuerier);
  }
}

createSpec(new SqliteQuerierSpec());
