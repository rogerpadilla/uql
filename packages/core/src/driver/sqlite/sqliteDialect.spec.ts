import { Item, User, createSpec } from '../../test';
import { BaseSqlDialectSpec } from '../baseSqlDialectSpec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends BaseSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldFind$text() {
    const sql1 = this.dialect.find(Item, {
      project: { id: 1 },
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(sql1).toBe("SELECT `id` FROM `Item` WHERE `Item` MATCH 'some text' AND `status` = 1 LIMIT 30");

    const sql2 = this.dialect.find(User, {
      project: { id: 1 },
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(sql2).toBe(
      "SELECT `id` FROM `User` WHERE `User` MATCH 'something' AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
    );
  }
}

createSpec(new SqliteDialectSpec());
