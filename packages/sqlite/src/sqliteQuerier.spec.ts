import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { createSpec } from '@uql/core/test';
import { SqliteQuerier } from './sqliteQuerier';

class MySqlQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(SqliteQuerier, {
      query: () => Promise.resolve([]),
      run: () => Promise.resolve({ lastID: 1 }),
      release: () => Promise.resolve(),
    });
  }
}

createSpec(new MySqlQuerierSpec());
