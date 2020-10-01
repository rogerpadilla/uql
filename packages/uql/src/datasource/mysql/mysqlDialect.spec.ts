import { Item, User } from 'uql/mock';
import { createSpec } from 'uql/test.util';
import { SqlDialectSpec } from '../sqlDialectSpec';
import { MySqlDialect } from './mysqlDialect';

export class MySqlDialectSpec extends SqlDialectSpec {
  constructor() {
    super(new MySqlDialect());
  }

  shouldBeginTransaction() {
    expect(this.sql.beginTransactionCommand).toBe('START TRANSACTION');
  }

  shouldFind$text() {
    const query1 = this.sql.find(Item, {
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(query1).toBe(
      "SELECT * FROM `Item` WHERE MATCH(`name`, `description`) AGAINST('some text') AND `status` = 1 LIMIT 30"
    );

    const query2 = this.sql.find(User, {
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(query2).toBe(
      "SELECT * FROM `User` WHERE MATCH(`name`) AGAINST('something') AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
    );
  }
}

createSpec(new MySqlDialectSpec());
