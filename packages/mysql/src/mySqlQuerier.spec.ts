import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { MySqlQuerier } from './mysqlQuerier';

class MySqlQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(MySqlQuerier);
  }
}

createSpec(new MySqlQuerierSpec());
