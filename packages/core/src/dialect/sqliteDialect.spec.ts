import { createSpec } from '@uql/core/test';
import { BaseSqlDialectSpec } from './baseSqlDialect-spec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }
}

createSpec(new SqliteDialectSpec());
