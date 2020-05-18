import { User, Item } from '../../entity/entityMock';
import { SqlDialect } from '../sqlDialect';
import { MySqlDialect } from './mysqlDialect';

let sql: SqlDialect;

beforeEach(() => {
  sql = new MySqlDialect();
});

it('transaction begin', () => {
  expect(sql.beginTransactionCommand).toBe('START TRANSACTION');
});

it('find $startsWith', () => {
  const query = sql.find(User, {
    filter: { name: { $startsWith: 'Some' } },
    sort: { name: 1, id: -1 },
    skip: 0,
    limit: 50,
  });
  expect(query).toBe("SELECT * FROM `User` WHERE LOWER(`name`) LIKE 'some%' ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0");
});

it('find $re', () => {
  const query = sql.find(User, {
    filter: { name: { $re: '^some' } },
  });
  expect(query).toBe("SELECT * FROM `User` WHERE `name` REGEXP '^some'");
});

it('find $text', () => {
  const query1 = sql.find(Item, {
    filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
    limit: 30,
  });
  expect(query1).toBe("SELECT * FROM `Item` WHERE MATCH(`name`, `description`) AGAINST('some text') AND `status` = 1 LIMIT 30");

  const query2 = sql.find(User, {
    filter: { $text: { fields: ['name'], value: 'something' }, name: { $ne: 'other unwanted' }, status: 1 },
    limit: 10,
  });
  expect(query2).toBe(
    "SELECT * FROM `User` WHERE MATCH(`name`) AGAINST('something') AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
  );
});
