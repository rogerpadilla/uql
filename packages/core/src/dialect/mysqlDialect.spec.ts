import { createSpec, Item, User } from '@uql/core/test';
import { AbstractSqlDialectSpec } from './abstractSqlDialect-spec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('START TRANSACTION');
  }

  override shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $project: ['id'],
        $filter: { $text: { $fields: ['name', 'description'], $value: 'some text' }, creatorId: 1 },
        $limit: 30,
      })
    ).toBe("SELECT `id` FROM `Item` WHERE MATCH(`name`, `description`) AGAINST('some text') AND `creatorId` = 1 LIMIT 30");

    expect(
      this.dialect.find(User, {
        $project: { id: true },
        $filter: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          creatorId: 1,
        },
        $limit: 10,
      })
    ).toBe("SELECT `id` FROM `User` WHERE MATCH(`name`) AGAINST('something') AND `name` <> 'other unwanted' AND `creatorId` = 1 LIMIT 10");
  }
}

createSpec(new MySqlDialectSpec());
