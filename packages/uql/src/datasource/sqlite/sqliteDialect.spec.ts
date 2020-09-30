import { Item, User } from 'uql/mock';
import { createSpec } from 'uql/test.util';
import { MySqlDialectSpec } from '../mysql/mysqlDialect.spec';
import { SqliteDialect } from './sqliteDialect';

class SqliteDialectSpec extends MySqlDialectSpec {
  beforeEach() {
    this.sql = new SqliteDialect();
  }

  'transaction begin'() {
    expect(this.sql.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  'find $text'() {
    const query1 = this.sql.find(Item, {
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(query1).toBe("SELECT * FROM `Item` WHERE `Item` MATCH 'some text' AND `status` = 1 LIMIT 30");

    const query2 = this.sql.find(User, {
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(query2).toBe(
      "SELECT * FROM `User` WHERE `User` MATCH 'something' AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
    );
  }
}

createSpec(new SqliteDialectSpec());
