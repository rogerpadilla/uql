import { User, Item, ItemAdjustment, TaxCategory, Spec, Profile, find, insert, remove, update } from '../test';

import { QueryFilter, QueryProject, QuerySort } from '../type';
import { BaseSqlDialect } from './baseSqlDialect';

export abstract class BaseSqlDialectSpec implements Spec {
  constructor(readonly dialect: BaseSqlDialect) {}

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('`');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('START TRANSACTION');
  }

  shouldCreate() {
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
    const sql = insert(this.dialect, User, bodies);
    expect(sql).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES' +
        " ('Some Name 1', 'someemail1@example.com', 123)" +
        ", ('Some Name 2', 'someemail2@example.com', 456)" +
        ", ('Some Name 3', 'someemail3@example.com', 789)"
    );
  }

  shouldCreateOne() {
    const body: User = {
      name: 'Some Name',
      email: 'someemail@example.com',
      createdAt: 123,
    };
    const sql = insert(this.dialect, User, body);
    expect(sql).toBe(
      "INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES ('Some Name', 'someemail@example.com', 123)"
    );
  }

  shouldCreateOneWithAutoId() {
    const body: TaxCategory = {
      name: 'Some Name',
      createdAt: 123,
    };
    const sql = insert(this.dialect, TaxCategory, body);
    expect(sql).toMatch(
      "^INSERT INTO `TaxCategory` \\(`name`, `createdAt`, `pk`\\) VALUES \\('Some Name', 123, '[a-f0-9\\-]+'\\)$"
    );
  }

  shouldUpdate() {
    const sql = update(
      this.dialect,
      User,
      { name: 'some', user: '123' },
      {
        name: 'Some Text',
        updatedAt: 321,
      }
    );
    expect(sql).toBe(
      "UPDATE `User` SET `name` = 'Some Text', `updatedAt` = 321 WHERE `name` = 'some' AND `user` = '123'"
    );
  }

  shouldFind() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { id: '123', name: 'abc' },
    });
    expect(sql1).toBe("SELECT `id` FROM `User` WHERE `id` = '123' AND `name` = 'abc'");

    const sql2 = find(this.dialect, Profile, {
      project: { id: 1, picture: 1, status: 1 },
      filter: { id: '123', picture: 'abc' },
    });
    expect(sql2).toBe(
      "SELECT `pk` `id`, `image` `picture`, `status` FROM `user_profile` WHERE `pk` = '123' AND `image` = 'abc'"
    );
  }

  shouldFind$and() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $and: { id: '123', name: 'abc' } },
    });
    expect(sql1).toBe("SELECT `id` FROM `User` WHERE `id` = '123' AND `name` = 'abc'");
    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $and: { id: '123', name: 'abc' } },
    });
    expect(sql2).toBe("SELECT `id` FROM `User` WHERE `id` = '123' AND `name` = 'abc'");
    const sql3 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $and: { id: '123' }, name: 'abc' },
    });
    expect(sql3).toBe("SELECT `id` FROM `User` WHERE `id` = '123' AND `name` = 'abc'");
  }

  shouldFind$or() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $or: { id: '123' } },
    });
    expect(sql1).toBe("SELECT `id` FROM `User` WHERE `id` = '123'");
    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $or: { id: '123', name: 'abc' } },
    });
    expect(sql2).toBe("SELECT `id` FROM `User` WHERE `id` = '123' OR `name` = 'abc'");
    const sql3 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $or: { id: '123' }, name: 'abc' },
    });
    expect(sql3).toBe("SELECT `id` FROM `User` WHERE `id` = '123' AND `name` = 'abc'");
  }

  shouldFindLogicalOperators() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { user: '1', $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' }, id: '1' },
    });
    expect(sql1).toBe(
      "SELECT `id` FROM `User` WHERE `user` = '1' AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com') AND `id` = '1'"
    );
    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: {
        user: '1',
        $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' },
        id: '1',
        email: 'e',
      },
    });
    expect(sql2).toBe(
      "SELECT `id` FROM `User` WHERE `user` = '1'" +
        " AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com') AND `id` = '1' AND `email` = 'e'"
    );
    const sql3 = find(this.dialect, User, {
      project: { id: 1 },
      filter: {
        user: '1',
        $or: { name: { $in: ['a', 'b', 'c'] }, email: 'abc@example.com' },
        id: '1',
        email: 'e',
      },
      sort: { name: 1, createdAt: -1 },
      skip: 50,
      limit: 10,
    });
    expect(sql3).toBe(
      "SELECT `id` FROM `User` WHERE `user` = '1'" +
        " AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com')" +
        " AND `id` = '1' AND `email` = 'e'" +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50'
    );
  }

  shouldFindSingleFilter() {
    const sql = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: 'some' },
      limit: 3,
    });
    expect(sql).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' LIMIT 3");
  }

  shouldFindMultipleComparisonOperators() {
    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { $or: { name: { $eq: 'other', $ne: 'other unwanted' }, status: 1 } },
      limit: 10,
    });
    expect(sql2).toBe(
      "SELECT `id` FROM `User` WHERE (`name` = 'other' AND `name` <> 'other unwanted') OR `status` = 1 LIMIT 10"
    );

    const sql3 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { createdAt: { $gte: 123, $lte: 999 } },
      limit: 10,
    });
    expect(sql3).toBe('SELECT `id` FROM `User` WHERE (`createdAt` >= 123 AND `createdAt` <= 999) LIMIT 10');

    const sql4 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { createdAt: { $gt: 123, $lt: 999 } },
      limit: 10,
    });
    expect(sql4).toBe('SELECT `id` FROM `User` WHERE (`createdAt` > 123 AND `createdAt` < 999) LIMIT 10');
  }

  shouldFind$ne() {
    const sql = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: 'some', status: { $ne: 5 } },
      limit: 20,
    });
    expect(sql).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' AND `status` <> 5 LIMIT 20");
  }

  shouldFindIsNotNull() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { user: '123', status: null },
      limit: 5,
    });
    expect(sql1).toBe("SELECT `id` FROM `User` WHERE `user` = '123' AND `status` IS NULL LIMIT 5");
    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { user: '123', status: { $ne: null } },
      limit: 5,
    });
    expect(sql2).toBe("SELECT `id` FROM `User` WHERE `user` = '123' AND `status` IS NOT NULL LIMIT 5");
  }

  shouldFind$in() {
    const sql = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: 'some', status: { $in: [1, 2, 3] } },
      limit: 10,
    });
    expect(sql).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' AND `status` IN (1, 2, 3) LIMIT 10");
  }

  shouldFind$nin() {
    const sql = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: 'some', status: { $nin: [1, 2, 3] } },
      limit: 10,
    });
    expect(sql).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' AND `status` NOT IN (1, 2, 3) LIMIT 10");
  }

  shouldFindPopulate() {
    const sql1 = find(this.dialect, User, {
      project: { id: true, name: true },
      populate: {
        profile: { project: { id: true, picture: true } },
      },
    });
    expect(sql1).toBe(
      'SELECT `User`.`id`, `User`.`name`, `profile`.`pk` `profile.id`, `profile`.`image` `profile.picture`' +
        ' FROM `User` LEFT JOIN `user_profile` `profile` ON `profile`.`user` = `User`.`id`'
    );
  }

  shouldFindPopulateWithProject() {
    const sql1 = find(this.dialect, Item, {
      project: { id: 1, name: 1, code: 1 },
      populate: {
        tax: { project: { id: 1, name: 1 }, required: true },
        measureUnit: { project: { id: 1, name: 1, category: 1 }, required: true },
      },
      limit: 100,
    });
    expect(sql1).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `Item`.`tax`, `Item`.`measureUnit`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`category` `measureUnit.category`' +
        ' FROM `Item`' +
        ' INNER JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`tax`' +
        ' INNER JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
        ' LIMIT 100'
    );

    const sql2 = find(this.dialect, User, { project: { id: 1 }, populate: { company: {} } });
    expect(sql2).toBe(
      'SELECT `User`.`id`, `User`.`company`, `company`.`id` `company.id`, `company`.`company` `company.company`, `company`.`user` `company.user`, `company`.`createdAt` `company.createdAt`, `company`.`updatedAt` `company.updatedAt`, `company`.`status` `company.status`, `company`.`name` `company.name`, `company`.`description` `company.description` FROM `User` LEFT JOIN `Company` `company` ON `company`.`id` = `User`.`company`'
    );
  }

  shouldFindPopulateWithAllFieldsAndSpecificFieldsAndFilterByPopulated() {
    const sql1 = find(this.dialect, Item, {
      project: { id: 1, name: 1 },
      populate: {
        tax: { project: { id: true, name: true }, filter: { id: 2 }, required: true },
        measureUnit: { project: { id: 1, name: 1 }, filter: { name: { $ne: 'unidad' } }, required: true },
      },
      sort: { 'category.name': 1, 'measureUnit.name': 1 } as QuerySort<Item>,
      limit: 100,
    });

    expect(sql1).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`tax`, `Item`.`measureUnit`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`' +
        ' FROM `Item`' +
        ' INNER JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`tax` AND `tax`.`id` = 2' +
        " INNER JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit` AND `measureUnit`.`name` <> 'unidad'" +
        ' ORDER BY `category`.`name`, `measureUnit`.`name` LIMIT 100'
    );

    const sql2 = find(this.dialect, Item, {
      project: { id: 1, name: 1 },
      populate: {
        tax: { project: { id: true, name: true } },
        measureUnit: { project: { id: 1, name: 1 } },
      },
      filter: { 'tax.id': 2, 'measureUnit.name': { $ne: 'unidad' } } as QueryFilter<Item>,
      sort: { 'category.name': 1, 'measureUnit.name': 1 } as QuerySort<Item>,
      limit: 100,
    });

    expect(sql2).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`tax`, `Item`.`measureUnit`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`' +
        ' FROM `Item`' +
        ' LEFT JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`tax`' +
        ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
        " WHERE `tax`.`id` = 2 AND `measureUnit`.`name` <> 'unidad'" +
        ' ORDER BY `category`.`name`, `measureUnit`.`name` LIMIT 100'
    );
  }

  shouldFindDeepPopulateWithProjectedFields() {
    const sql1 = find(this.dialect, Item, {
      project: { id: 1, name: 1, code: 1 },
      populate: {
        measureUnit: {
          project: { id: 1, name: 1, category: 1 },
          populate: { category: { project: { name: 1 } } },
        },
      },
      limit: 100,
    });
    expect(sql1).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `Item`.`measureUnit`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`category` `measureUnit.category`' +
        ', `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item`' +
        ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`category`' +
        ' LIMIT 100'
    );
    const sql2 = find(this.dialect, Item, {
      project: { id: 1, name: 1, code: 1 },
      populate: {
        measureUnit: {
          project: { id: 1, name: 1 },
          populate: { category: { project: { id: 1, name: 1 } } },
        },
      },
      limit: 100,
    });
    expect(sql2).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `Item`.`measureUnit`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`category` `measureUnit.category`' +
        ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item`' +
        ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnit`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`category`' +
        ' LIMIT 100'
    );
    const sql3 = find(this.dialect, ItemAdjustment, {
      project: { id: 1, buyPrice: 1, number: 1 },
      populate: {
        item: {
          project: { id: 1, name: 1 },
          populate: {
            measureUnit: {
              project: { id: 1, name: 1 },
              populate: { category: { project: { id: 1, name: 1 } } },
            },
          },
        },
      },
      limit: 100,
    });
    expect(sql3).toBe(
      'SELECT `ItemAdjustment`.`id`, `ItemAdjustment`.`buyPrice`, `ItemAdjustment`.`number`, `ItemAdjustment`.`item`' +
        ', `item`.`id` `item.id`, `item`.`name` `item.name`, `item`.`measureUnit` `item.measureUnit`' +
        ', `item.measureUnit`.`id` `item.measureUnit.id`, `item.measureUnit`.`name` `item.measureUnit.name`, `item.measureUnit`.`category` `item.measureUnit.category`' +
        ', `item.measureUnit.category`.`id` `item.measureUnit.category.id`, `item.measureUnit.category`.`name` `item.measureUnit.category.name`' +
        ' FROM `ItemAdjustment`' +
        ' LEFT JOIN `Item` `item` ON `item`.`id` = `ItemAdjustment`.`item`' +
        ' LEFT JOIN `MeasureUnit` `item.measureUnit` ON `item.measureUnit`.`id` = `item`.`measureUnit`' +
        ' LEFT JOIN `MeasureUnitCategory` `item.measureUnit.category` ON `item.measureUnit.category`.`id` = `item.measureUnit`.`category`' +
        ' LIMIT 100'
    );
  }

  shouldFindPopulatePropertiesWithNotFixedType() {
    const sql = find(this.dialect, Item, {
      project: { id: 1, name: 1 },
      populate: { user: { project: { id: 1, name: 1 } }, company: { project: { id: 1, name: 1 } } },
    });
    expect(sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`user`, `Item`.`company`' +
        ', `user`.`id` `user.id`, `user`.`name` `user.name`' +
        ', `company`.`id` `company.id`, `company`.`name` `company.name`' +
        ' FROM `Item`' +
        ' LEFT JOIN `User` `user` ON `user`.`id` = `Item`.`user`' +
        ' LEFT JOIN `Company` `company` ON `company`.`id` = `Item`.`company`'
    );
  }

  shouldFindGroup() {
    const sql1 = find(this.dialect, User, {
      group: ['company'],
    });
    expect(sql1).toBe(
      'SELECT `id`, `company`, `user`, `createdAt`, `updatedAt`, `status`, `name`, `email`, `password` FROM `User` GROUP BY `company`'
    );
    const sql2 = find(this.dialect, User, {
      project: { id: 1, name: 1 },
      filter: { status: 1 },
      group: ['company'],
      skip: 50,
      limit: 100,
      sort: { name: 1 },
    });
    expect(sql2).toBe(
      'SELECT `id`, `name` FROM `User` WHERE `status` = 1 GROUP BY `company` ORDER BY `name` LIMIT 100 OFFSET 50'
    );
  }

  shouldFindLimit() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { id: '9' },
      limit: 1,
    });
    expect(sql1).toBe("SELECT `id` FROM `User` WHERE `id` = '9' LIMIT 1");
    const sql2 = find(this.dialect, User, {
      project: { id: 1, name: 1, user: 1 },
      filter: { id: '9' },
      limit: 1,
    });
    expect(sql2).toBe("SELECT `id`, `name`, `user` FROM `User` WHERE `id` = '9' LIMIT 1");
    const sql3 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: 'something', user: '123' },
      limit: 1,
    });
    expect(sql3).toBe("SELECT `id` FROM `User` WHERE `name` = 'something' AND `user` = '123' LIMIT 1");
    const sql4 = find(this.dialect, User, {
      project: { id: 1, name: 1, user: 1 },
      filter: { user: '123' },
      limit: 25,
    });
    expect(sql4).toBe("SELECT `id`, `name`, `user` FROM `User` WHERE `user` = '123' LIMIT 25");
  }

  shouldFindProject() {
    expect(
      find(this.dialect, User, {
        project: { password: false },
      })
    ).toBe('SELECT `id`, `company`, `user`, `createdAt`, `updatedAt`, `status`, `name`, `email` FROM `User`');

    expect(
      find(this.dialect, User, {
        project: { name: 0, password: 0 },
      })
    ).toBe('SELECT `id`, `company`, `user`, `createdAt`, `updatedAt`, `status`, `email` FROM `User`');

    expect(
      find(this.dialect, User, {
        project: { id: 1, name: 1, password: 0 },
      })
    ).toBe('SELECT `id`, `name` FROM `User`');

    expect(
      find(this.dialect, User, {
        project: { id: 1, name: 0, password: 0 },
      })
    ).toBe('SELECT `id` FROM `User`');

    expect(
      find(
        this.dialect,
        User,
        {
          project: {
            '*': 1,
            'LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt AS hotness': 1,
          } as QueryProject<User>,
          filter: { name: 'something' },
        },
        { isTrustedProject: true }
      )
    ).toBe(
      'SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt AS hotness' +
        " FROM `User` WHERE `name` = 'something'"
    );
  }

  shouldRemove() {
    const sql = remove(this.dialect, User, { id: '123' });
    expect(sql).toBe("DELETE FROM `User` WHERE `id` = '123'");
  }

  shouldFind$startsWith() {
    const sql1 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: { $startsWith: 'Some' } },
      sort: { name: 1, id: -1 },
      skip: 0,
      limit: 50,
    });
    expect(sql1).toBe(
      "SELECT `id` FROM `User` WHERE LOWER(`name`) LIKE 'some%' ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0"
    );
    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: { $startsWith: 'Some', $ne: 'Something' } },
      sort: { name: 1, id: -1 },
      skip: 0,
      limit: 50,
    });
    expect(sql2).toBe(
      "SELECT `id` FROM `User` WHERE (LOWER(`name`) LIKE 'some%' AND `name` <> 'Something') ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0"
    );
  }

  shouldFind$re() {
    const sql = find(this.dialect, User, {
      project: { id: 1 },
      filter: { name: { $re: '^some' } },
    });
    expect(sql).toBe("SELECT `id` FROM `User` WHERE `name` REGEXP '^some'");
  }

  shouldFind$text() {
    const sql1 = find(this.dialect, Item, {
      project: { id: 1 },
      filter: { $text: { fields: ['name', 'description'], value: 'some text' }, status: 1 },
      limit: 30,
    });
    expect(sql1).toBe(
      "SELECT `id` FROM `Item` WHERE MATCH(`name`, `description`) AGAINST('some text') AND `status` = 1 LIMIT 30"
    );

    const sql2 = find(this.dialect, User, {
      project: { id: 1 },
      filter: {
        $text: { fields: ['name'], value: 'something' },
        name: { $ne: 'other unwanted' },
        status: 1,
      },
      limit: 10,
    });
    expect(sql2).toBe(
      "SELECT `id` FROM `User` WHERE MATCH(`name`) AGAINST('something') AND `name` <> 'other unwanted' AND `status` = 1 LIMIT 10"
    );
  }

  shouldFindPopulateNotAnnotatedField() {
    expect(() =>
      find(this.dialect, User, {
        populate: { status: {} },
      })
    ).toThrow("'User.status' is not annotated as a relation");
  }
}
