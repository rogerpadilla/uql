import { User, Item } from '../../entity/entityMock';
import { SqlDialect } from '../sqlDialect';
import { SqliteDialect } from './sqliteDialect';

let sql: SqlDialect;

beforeEach(() => {
  sql = new SqliteDialect();
});

it('transaction begin', () => {
  expect(sql.beginTransactionCommand).toBe('BEGIN TRANSACTION');
});

it('find $startsWith', () => {
  const query = sql.find(User, {
    filter: { name: { $startsWith: 'Some' } },
    sort: { name: 1, id: -1 },
    skip: 0,
    limit: 50,
  });
  expect(query).toBe("SELECT * FROM `user` WHERE LOWER(`name`) LIKE 'some%' ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0");
});

it('find $re', () => {
  const query = sql.find(User, {
    filter: { name: { $re: '^some' } },
  });
  expect(query).toBe("SELECT * FROM `user` WHERE `name` REGEXP '^some'");
});

it('find $text', () => {
  const query1 = sql.find(Item, {
    filter: { $text: { value: 'some text' }, status: 1 },
    limit: 30,
  });
  expect(query1).toBe("SELECT * FROM `Item` WHERE `Item` MATCH 'some text' AND `status` = 1 LIMIT 30");

  const query2 = sql.find(User, {
    filter: { $text: { value: 'something' }, name: { $ne: 'other unwanted' }, status: 1 },
    limit: 10,
  });
  expect(query2).toBe(
    "SELECT * FROM `user` WHERE `user` MATCH 'something' AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
  );
});
