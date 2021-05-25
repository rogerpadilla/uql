import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { PostgresQuerier } from './postgresQuerier';

class PostgrestQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(PostgresQuerier, {
      query: () =>
        Promise.resolve({
          rows: [{ insertid: 1 }, { insertid: 2 }],
        }),
      release: () => Promise.resolve(),
    });
  }
}

createSpec(new PostgrestQuerierSpec());
