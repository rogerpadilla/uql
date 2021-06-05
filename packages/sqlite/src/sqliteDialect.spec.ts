import { BaseSqlDialectSpec } from '@uql/core/sql/baseSqlDialect-spec';
import { Item, User, createSpec } from '@uql/core/test';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }
}

createSpec(new SqliteDialectSpec());
