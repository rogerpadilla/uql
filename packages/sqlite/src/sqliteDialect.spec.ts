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

  shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $project: { id: 1 },
        $filter: { $text: { $fields: ['name', 'description'], $value: 'some text' }, status: 1 },
        $limit: 30,
      })
    ).toBe("SELECT id FROM Item WHERE Item MATCH 'some text' AND status = 1 LIMIT 30");

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          status: 1,
        },
        $limit: 10,
      })
    ).toBe("SELECT id FROM User WHERE User MATCH 'something' AND name <> 'other unwanted' AND status = 1 LIMIT 10");
  }
}

createSpec(new SqliteDialectSpec());
