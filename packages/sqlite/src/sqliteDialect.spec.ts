import { BaseSqlDialectSpec } from '@uql/core/sql/baseSqlDialect-spec';
import { createSpec } from '@uql/core/test';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }
}

createSpec(new SqliteDialectSpec());
