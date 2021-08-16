import { createSpec, Item, User } from '@uql/core/test';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  override shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $project: { id: true },
        $filter: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      })
    ).toBe("SELECT `id` FROM `Item` WHERE `Item` MATCH 'some text' AND `companyId` = 1 LIMIT 30");

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: 1,
        },
        $limit: 10,
      })
    ).toBe("SELECT `id` FROM `User` WHERE `User` MATCH 'something' AND `name` <> 'other unwanted' AND `companyId` = 1 LIMIT 10");
  }
}

createSpec(new SqliteDialectSpec());
