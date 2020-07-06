import { User, Item, ItemAdjustment } from '../../entity/entityMock';
import { SqlDialect } from '../sqlDialect';
import { Query, QuerySort } from '../../type';
import { MySqlDialect } from './mysqlDialect';

let sql: SqlDialect;

beforeEach(() => {
  sql = new MySqlDialect();
});

it('transaction begin', () => {
  expect(sql.beginTransactionCommand).toBe('START TRANSACTION');
});

it('create', () => {
  const bodies: User[] = [
    {
      name: 'Some Name 1',
      email: 'someemail1@example.com',
      createdAt: 123,
    },
    {
      name: 'Some Name 2',
      email: 'someemail2@example.com',
      createdAt: 456,
    },
    {
      name: 'Some Name 3',
      email: 'someemail3@example.com',
      createdAt: 789,
    },
  ];
  const query = sql.insert(User, bodies);
  expect(query).toStartsWith(
    'INSERT INTO `user` (`name`, `email`, `createdAt`) VALUES' +
      " ('Some Name 1', 'someemail1@example.com', 123)" +
      ", ('Some Name 2', 'someemail2@example.com', 456)" +
      ", ('Some Name 3', 'someemail3@example.com', 789)"
  );
});

it('create - one', () => {
  const body: User = {
    id: 1,
    name: 'Some Name',
    email: 'someemail@example.com',
    createdAt: 123,
    updatedAt: 321,
  };
  const query = sql.insert(User, body);
  expect(query).toStartsWith(
    "INSERT INTO `user` (`name`, `email`, `createdAt`) VALUES ('Some Name', 'someemail@example.com', 123)"
  );
});

it('update', () => {
  const body: User = {
    id: 25,
    name: 'Some Text',
    user: 1,
    createdAt: 123,
    updatedAt: 321,
  };
  const query = sql.update(User, { name: 'some', user: 123 }, body);
  expect(query).toBe("UPDATE `user` SET `name` = 'Some Text', `updatedAt` = 321 WHERE `name` = 'some' AND `user` = 123");
});

it('find', () => {
  const query = sql.find(User, {
    filter: { id: 123, name: 'abc' },
  });
  expect(query).toBe("SELECT * FROM `user` WHERE `id` = 123 AND `name` = 'abc'");
});

it('find $and', () => {
  const quer1 = sql.find(User, {
    filter: { $and: { id: 123, name: 'abc' } },
  });
  expect(quer1).toBe("SELECT * FROM `user` WHERE `id` = 123 AND `name` = 'abc'");
  const query2 = sql.find(User, {
    filter: { $and: { id: 123, name: 'abc' } },
  });
  expect(query2).toBe("SELECT * FROM `user` WHERE `id` = 123 AND `name` = 'abc'");
  const query3 = sql.find(User, {
    filter: { $and: { id: 123 }, name: 'abc' },
  });
  expect(query3).toBe("SELECT * FROM `user` WHERE `id` = 123 AND `name` = 'abc'");
});

it('find $or', () => {
  const query1 = sql.find(User, {
    filter: { $or: { id: 123 } },
  });
  expect(query1).toBe('SELECT * FROM `user` WHERE `id` = 123');
  const query2 = sql.find(User, {
    filter: { $or: { id: 123, name: 'abc' } },
  });
  expect(query2).toBe("SELECT * FROM `user` WHERE `id` = 123 OR `name` = 'abc'");
  const query3 = sql.find(User, {
    filter: { $or: { id: 123 }, name: 'abc' },
  });
  expect(query3).toBe("SELECT * FROM `user` WHERE `id` = 123 AND `name` = 'abc'");
});

it('find logical operators', () => {
  const query1 = sql.find(User, {
    filter: { user: 1, $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' }, id: 1 },
  });
  expect(query1).toBe(
    "SELECT * FROM `user` WHERE `user` = 1 AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com') AND `id` = 1"
  );
  const query2 = sql.find(User, {
    filter: { user: 1, $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' }, id: 1, email: 'e' },
  });
  expect(query2).toBe(
    'SELECT * FROM `user` WHERE `user` = 1' +
      " AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com') AND `id` = 1 AND `email` = 'e'"
  );
  const query3 = sql.find(User, {
    filter: { user: 1, $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' }, id: 1, email: 'e' },
    sort: { name: 1, createdAt: -1 },
    skip: 50,
    limit: 10,
  });
  expect(query3).toBe(
    'SELECT * FROM `user` WHERE `user` = 1' +
      " AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com')" +
      " AND `id` = 1 AND `email` = 'e'" +
      ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50'
  );
});

it('find single filter', () => {
  const query = sql.find(User, {
    filter: { name: 'some' },
    limit: 3,
  });
  expect(query).toBe("SELECT * FROM `user` WHERE `name` = 'some' LIMIT 3");
});

it('find unsupported comparison operator', () => {
  expect(() =>
    sql.find(User, {
      filter: { name: { $someInvalidOperator: 'some' } as unknown },
    })
  ).toThrowError('Unsupported comparison operator: $someInvalidOperator');
});

it('find multiple comparison-operators', () => {
  const query2 = sql.find(User, {
    filter: { $or: { name: { $eq: 'other', $ne: 'other unwanted' }, status: 1 } },
    limit: 10,
  });
  expect(query2).toBe("SELECT * FROM `user` WHERE (`name` = 'other' AND `name` <> 'other unwanted') OR `status` = 1 LIMIT 10");

  const query3 = sql.find(User, {
    filter: { createdAt: { $gte: 123, $lte: 999 } },
    limit: 10,
  });
  expect(query3).toBe('SELECT * FROM `user` WHERE (`createdAt` >= 123 AND `createdAt` <= 999) LIMIT 10');

  const query4 = sql.find(User, {
    filter: { createdAt: { $gt: 123, $lt: 999 } },
    limit: 10,
  });
  expect(query4).toBe('SELECT * FROM `user` WHERE (`createdAt` > 123 AND `createdAt` < 999) LIMIT 10');
});

it('find $ne', () => {
  const query = sql.find(User, {
    filter: { name: 'some', status: { $ne: 5 } },
    limit: 20,
  });
  expect(query).toBe("SELECT * FROM `user` WHERE `name` = 'some' AND `status` <> 5 LIMIT 20");
});

it('find IS (NOT) NULL', () => {
  const query1 = sql.find(User, {
    filter: { user: 123, status: null },
    limit: 5,
  });
  expect(query1).toBe('SELECT * FROM `user` WHERE `user` = 123 AND `status` IS NULL LIMIT 5');
  const query2 = sql.find(User, {
    filter: { user: 123, status: { $ne: null } },
    limit: 5,
  });
  expect(query2).toBe('SELECT * FROM `user` WHERE `user` = 123 AND `status` IS NOT NULL LIMIT 5');
});

it('find $in', () => {
  const query = sql.find(User, {
    filter: { name: 'some', status: { $in: [1, 2, 3] } },
    limit: 10,
  });
  expect(query).toBe("SELECT * FROM `user` WHERE `name` = 'some' AND `status` IN (1, 2, 3) LIMIT 10");
});

it('find $nin', () => {
  const query = sql.find(User, {
    filter: { name: 'some', status: { $nin: [1, 2, 3] } },
    limit: 10,
  });
  expect(query).toBe("SELECT * FROM `user` WHERE `name` = 'some' AND `status` NOT IN (1, 2, 3) LIMIT 10");
});

it('find populate with projected fields', () => {
  const query = sql.find(Item, {
    project: { id: 1, name: 1, code: 1 },
    populate: { tax: { project: { id: 1, name: 1 } }, measureUnit: { project: { id: 1, name: 1, category: 1 } } },
    limit: 100,
  });
  expect(query).toBe(
    'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
      ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
      ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`category` `measureUnit.category`' +
      ' FROM `Item`' +
      ' LEFT JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`tax`' +
      ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
      ' LIMIT 100'
  );
});

it('find populates with all fields and specific fields, and filter by populated', () => {
  const qm: Query<Item> = {
    project: { id: 1, name: 1 },
    populate: { tax: null, measureUnit: { project: { id: 1, name: 1 } } },
    filter: { 'measureUnit.name': { $ne: 'unidad' }, 'tax.id': 2 } as Item,
    sort: { 'category.name': 1, 'MeasureUnit.name': 1 } as QuerySort<Item>,
    limit: 100,
  };
  const query = sql.find(Item, qm);
  expect(query).toBe(
    'SELECT `Item`.`id`, `Item`.`name`' +
      ', `tax`.`id` `tax.id`, `tax`.`company` `tax.company`, `tax`.`user` `tax.user`, `tax`.`createdAt` `tax.createdAt`' +
      ', `tax`.`updatedAt` `tax.updatedAt`, `tax`.`status` `tax.status`, `tax`.`name` `tax.name`, `tax`.`percentage` `tax.percentage`' +
      ', `tax`.`category` `tax.category`, `tax`.`description` `tax.description`' +
      ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`' +
      ' FROM `Item`' +
      ' LEFT JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`tax`' +
      ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
      " WHERE `measureUnit`.`name` <> 'unidad' AND `tax`.`id` = 2" +
      ' ORDER BY `category`.`name`, `MeasureUnit`.`name` LIMIT 100'
  );
});

it('find deep populate with projected fields', () => {
  const query1 = sql.find(Item, {
    project: { id: 1, name: 1, code: 1 },
    populate: {
      measureUnit: { project: { id: 1, name: 1, category: 1 }, populate: { category: { project: { name: 1 } } } },
    },
    limit: 100,
  });
  expect(query1).toBe(
    'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
      ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`category` `measureUnit.category`' +
      ', `measureUnit.category`.`name` `measureUnit.category.name`' +
      ' FROM `Item`' +
      ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
      ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`category`' +
      ' LIMIT 100'
  );
  const query2 = sql.find(Item, {
    project: { id: 1, name: 1, code: 1 },
    populate: {
      measureUnit: { project: { id: 1, name: 1 }, populate: { category: { project: { id: 1, name: 1 } } } },
    },
    limit: 100,
  });
  expect(query2).toBe(
    'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
      ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`' +
      ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
      ' FROM `Item`' +
      ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
      ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`category`' +
      ' LIMIT 100'
  );
  const query3 = sql.find(ItemAdjustment, {
    project: { id: 1, buyPrice: 1, number: 1 },
    populate: {
      item: {
        project: { id: 1, name: 1 },
        populate: {
          measureUnit: { project: { id: 1, name: 1 }, populate: { category: { project: { id: 1, name: 1 } } } },
        },
      },
    },
    limit: 100,
  });
  expect(query3).toBe(
    'SELECT `ItemAdjustment`.`id`, `ItemAdjustment`.`buyPrice`, `ItemAdjustment`.`number`' +
      ', `item`.`id` `item.id`, `item`.`name` `item.name`' +
      ', `item.measureUnit`.`id` `item.measureUnit.id`, `item.measureUnit`.`name` `item.measureUnit.name`' +
      ', `item.measureUnit.category`.`id` `item.measureUnit.category.id`, `item.measureUnit.category`.`name` `item.measureUnit.category.name`' +
      ' FROM `ItemAdjustment`' +
      ' LEFT JOIN `Item` `item` ON `item`.`id` = `ItemAdjustment`.`item`' +
      ' LEFT JOIN `MeasureUnit` `item.measureUnit` ON `item.measureUnit`.`id` = `item`.`measureUnit`' +
      ' LEFT JOIN `MeasureUnitCategory` `item.measureUnit.category` ON `item.measureUnit.category`.`id` = `item.measureUnit`.`category`' +
      ' LIMIT 100'
  );
});

it('find populate columns with not fixed type', () => {
  const query = sql.find(Item, {
    project: { id: 1, name: 1 },
    populate: { user: { project: { id: 1, name: 1 } }, company: { project: { id: 1, name: 1 } } },
  });
  expect(query).toBe(
    'SELECT `Item`.`id`, `Item`.`name`' +
      ', `user`.`id` `user.id`, `user`.`name` `user.name`' +
      ', `company`.`id` `company.id`, `company`.`name` `company.name`' +
      ' FROM `Item`' +
      ' LEFT JOIN `user` `user` ON `user`.`id` = `Item`.`user`' +
      ' LEFT JOIN `Company` `company` ON `company`.`id` = `Item`.`company`'
  );
});

it('find populate not annotated field', () => {
  expect(() =>
    sql.find(Item, {
      project: { id: 1, name: 1 },
      populate: { status: null },
    })
  ).toThrow("'Item.status' is not annotated with a relation decorator");
});

it('find group', () => {
  const query1 = sql.find(User, {
    group: ['company'],
  });
  expect(query1).toBe('SELECT * FROM `user` GROUP BY `company`');
  const query2 = sql.find(User, {
    project: { id: 1, name: 1 },
    filter: { status: 1 },
    group: ['company', 'profile'],
    skip: 50,
    limit: 100,
    sort: { name: 1 },
  });
  expect(query2).toBe(
    'SELECT `id`, `name` FROM `user` WHERE `status` = 1 GROUP BY `company`, `profile` ORDER BY `name` LIMIT 100 OFFSET 50'
  );
});

it('find limit', () => {
  const query1 = sql.find(User, {
    filter: { id: 9 },
    limit: 1,
  });
  expect(query1).toBe('SELECT * FROM `user` WHERE `id` = 9 LIMIT 1');
  const query2 = sql.find(User, {
    filter: { id: 9 },
    project: { id: 1, name: 1, user: 1 },
    limit: 1,
  });
  expect(query2).toBe('SELECT `id`, `name`, `user` FROM `user` WHERE `id` = 9 LIMIT 1');
  const query3 = sql.find(User, {
    filter: { name: 'something', user: 123 },
    limit: 1,
  });
  expect(query3).toBe("SELECT * FROM `user` WHERE `name` = 'something' AND `user` = 123 LIMIT 1");
  const query4 = sql.find(User, {
    project: { id: 1, name: 1, user: 1 },
    filter: { user: 123 },
    limit: 25,
  });
  expect(query4).toBe('SELECT `id`, `name`, `user` FROM `user` WHERE `user` = 123 LIMIT 25');
});

it('find select as functions', () => {
  const query = sql.find(
    User,
    {
      project: { '*': 1, 'LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt AS hotness': 1 } as any,
      filter: { name: 'something' },
    },
    { isTrustedProject: true }
  );
  expect(query).toBe(
    'SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt AS hotness' + " FROM `user` WHERE `name` = 'something'"
  );
});

it('remove', () => {
  const query1 = sql.remove(User, { id: 123 }, 1);
  expect(query1).toBe('DELETE FROM `user` WHERE `id` = 123 LIMIT 1');
  const query2 = sql.remove(User, { company: 123 });
  expect(query2).toBe('DELETE FROM `user` WHERE `company` = 123');
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
    filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
    limit: 30,
  });
  expect(query1).toBe("SELECT * FROM `Item` WHERE MATCH(`name`, `description`) AGAINST('some text') AND `status` = 1 LIMIT 30");

  const query2 = sql.find(User, {
    filter: { $text: { fields: ['name'], value: 'something' }, name: { $ne: 'other unwanted' }, status: 1 },
    limit: 10,
  });
  expect(query2).toBe(
    "SELECT * FROM `user` WHERE MATCH(`name`) AGAINST('something') AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
  );
});
