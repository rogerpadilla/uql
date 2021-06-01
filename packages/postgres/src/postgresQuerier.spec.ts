import { createSpec } from '@uql/core/test';
import { BaseSqlQuerierSpec } from '@uql/core/sql/baseSqlQuerier-spec';
import { PostgresQuerier } from './postgresQuerier';

class PostgrestQuerierSpec extends BaseSqlQuerierSpec {
  constructor() {
    super(PostgresQuerier);
  }
}

createSpec(new PostgrestQuerierSpec());
