import { Item, User, createSpec } from '../../test';
import { BaseSqlDialectSpec } from '../baseSqlDialectSpec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }

  shouldBeginTransaction() {
    expect(this.sql.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldFind$text() {
    const query1 = this.sql.find(Item, {
      project: { id: 1 },
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(query1).toBe("SELECT `id` FROM `Item` WHERE `Item` MATCH 'some text' AND `status` = 1 LIMIT 30");

    const query2 = this.sql.find(User, {
      project: { id: 1 },
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(query2).toBe(
      "SELECT `id` FROM `User` WHERE `User` MATCH 'something' AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
    );
  }
}

createSpec(new SqliteDialectSpec());
