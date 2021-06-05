import { createSpec, Item, User } from '@uql/core/test';
import { BaseSqlDialectSpec } from '@uql/core/sql/baseSqlDialect-spec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }

  shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $project: { id: 1 },
        $filter: { $text: { $fields: ['name', 'description'], $value: 'some text' }, status: 1 },
        $limit: 30,
      })
    ).toBe("SELECT id FROM Item WHERE MATCH(name, description) AGAINST('some text') AND status = 1 LIMIT 30");

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
    ).toBe(
      "SELECT id FROM User WHERE MATCH(name) AGAINST('something') AND name <> 'other unwanted' AND status = 1 LIMIT 10"
    );
  }
}

createSpec(new MySqlDialectSpec());
