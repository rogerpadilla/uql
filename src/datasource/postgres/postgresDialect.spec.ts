import { User, Item } from '../../entity/entityMock';
import { SqlDialect } from '../sqlDialect';
import { PostgresDialect } from './postgresDialect';

let sql: SqlDialect;

beforeEach(() => {
  sql = new PostgresDialect();
});

it('transaction begin', () => {
  expect(sql.beginTransactionCommand).toBe('BEGIN');
});

it('find $startsWith', () => {
  const query = sql.find(User, {
    filter: { name: { $startsWith: 'Some' } },
    sort: { name: 1, id: -1 },
    skip: 0,
    limit: 50,
  });
  expect(query).toBe("SELECT * FROM `User` WHERE `name` ILIKE 'Some%' ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0");
});

it('find $re', () => {
  const query = sql.find(User, {
    filter: { name: { $re: '^some' } },
  });
  expect(query).toBe("SELECT * FROM `User` WHERE `name` ~ '^some'");
});

it('find $text', () => {
  const query1 = sql.find(Item, {
    filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
    limit: 30,
  });
  expect(query1).toBe(
    "SELECT * FROM `Item` WHERE to_tsvector(`name` || ' ' || `description`) @@ to_tsquery('some text') AND `status` = 1 LIMIT 30"
  );

  const query2 = sql.find(User, {
    filter: { $text: { fields: ['name'], value: 'something' }, name: { $ne: 'other unwanted' }, status: 1 },
    limit: 10,
  });
  expect(query2).toBe(
    "SELECT * FROM `User` WHERE to_tsvector(`name`) @@ to_tsquery('something') AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
  );
});
