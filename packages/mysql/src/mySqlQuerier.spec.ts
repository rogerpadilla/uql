import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { MySqlQuerier } from './mysqlQuerier';

class MySqlQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(MySqlQuerier, {
      query: () => Promise.resolve([{ insertId: 1, affectedRows: 1 }]),
      release: () => Promise.resolve(),
    });
  }
}

createSpec(new MySqlQuerierSpec());
