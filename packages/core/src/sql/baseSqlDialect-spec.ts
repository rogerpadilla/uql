import { User, Item, ItemAdjustment, TaxCategory, Profile, InventoryAdjustment, MeasureUnit } from '../test/entityMock';

import { FieldKey, QueryFilter, QuerySort } from '../type';
import { Spec } from '../test/spec.util';
import { raw } from '../querier';
import { BaseSqlDialect } from './baseSqlDialect';

export abstract class BaseSqlDialectSpec implements Spec {
  constructor(readonly dialect: BaseSqlDialect) {}

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('`');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  shouldInsertMany() {
    expect(
      this.dialect.insert(User, [
        {
          name: 'Some name 1',
          email: 'someemail1@example.com',
          createdAt: 123,
        },
        {
          name: 'Some name 2',
          email: 'someemail2@example.com',
          createdAt: 456,
        },
        {
          name: 'Some name 3',
          email: 'someemail3@example.com',
          createdAt: 789,
        },
      ])
    ).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES' +
        " ('Some name 1', 'someemail1@example.com', 123)" +
        ", ('Some name 2', 'someemail2@example.com', 456)" +
        ", ('Some name 3', 'someemail3@example.com', 789)"
    );
  }

  shouldInsertOne() {
    expect(
      this.dialect.insert(User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      })
    ).toBe("INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES ('Some Name', 'someemail@example.com', 123)");

    expect(
      this.dialect.insert(InventoryAdjustment, {
        date: new Date(2021, 11, 31, 23, 59, 59, 999),
        createdAt: 123,
      })
    ).toBe("INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES ('2021-12-31 23:59:59.999', 123)");
  }

  shouldInsertWithOnInsertId() {
    expect(
      this.dialect.insert(TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      })
    ).toMatch(/^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \('Some Name', 123, '.+'\)$/);
  }

  shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    expect(
      this.dialect.insert(TaxCategory, [
        {
          name: 'Some Name A',
        },
        {
          pk: '50',
          name: 'Some Name B',
        },
        {
          name: 'Some Name C',
        },
        {
          pk: '70',
          name: 'Some Name D',
        },
      ])
    ).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \('Some Name A', \d+, '.+'\), \('Some Name B', \d+, '50'\), \('Some Name C', \d+, '.+'\), \('Some Name D', \d+, '70'\)$/
    );
  }

  shouldUpdate() {
    expect(
      this.dialect.update(
        User,
        {
          name: 'Some Text',
          updatedAt: 321,
        },
        { $filter: { name: 'some', creatorId: 123 } }
      )
    ).toBe("UPDATE `User` SET `name` = 'Some Text', `updatedAt` = 321 WHERE `name` = 'some' AND `creatorId` = 123");
  }

  shouldFind() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { id: 123, name: 'abc' },
      })
    ).toBe("SELECT `id` FROM `User` WHERE `id` = 123 AND `name` = 'abc'");

    expect(
      this.dialect.find(Profile, {
        $project: ['id', 'picture', 'companyId'],
        $filter: { id: 123, picture: 'abc' },
      })
    ).toBe("SELECT `pk` `id`, `image` `picture`, `companyId` FROM `user_profile` WHERE `pk` = 123 AND `image` = 'abc'");

    expect(
      this.dialect.find(MeasureUnit, {
        $project: ['id'],
        $filter: { id: 123, name: 'abc' },
      })
    ).toBe("SELECT `id` FROM `MeasureUnit` WHERE `id` = 123 AND `name` = 'abc' AND `deletedAt` IS NULL");
  }

  shouldBeSecure() {
    expect(
      this.dialect.find(User, {
        $project: ['id', 'something' as FieldKey<User>],
        $filter: {
          id: 1,
          something: 1,
        } as any,
        $sort: {
          id: 1,
          something: 1,
        } as any,
        $group: ['id', 'something' as any],
      })
    ).toBe(
      'SELECT `id` FROM `User` WHERE `id` = 1 AND `something` = 1 GROUP BY `id`, `something` ORDER BY `id`, `something`'
    );

    expect(
      this.dialect.insert(User, {
        name: 'Some Name',
        something: 'anything',
        createdAt: 1,
      } as any)
    ).toBe("INSERT INTO `User` (`name`, `createdAt`) VALUES ('Some Name', 1)");

    expect(
      this.dialect.update(
        User,
        {
          name: 'Some Name',
          something: 'anything',
          updatedAt: 1,
        } as any,
        {
          $filter: { something: 'anything' },
        }
      )
    ).toBe("UPDATE `User` SET `name` = 'Some Name', `updatedAt` = 1 WHERE `something` = 'anything'");

    expect(
      this.dialect.delete(User, {
        $filter: { something: 'anything' } as any,
      })
    ).toBe("DELETE FROM `User` WHERE `something` = 'anything'");
  }

  shouldFind$and() {
    const sql = "SELECT `id` FROM `User` WHERE `id` = 123 AND `name` = 'abc'";

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { $and: [{ id: 123, name: 'abc' }] },
      })
    ).toBe(sql);

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: { $and: [{ id: 123 }], name: 'abc' },
      })
    ).toBe(sql);
  }

  shouldFind$or() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { $or: [{ id: 123 }, { name: 'abc' }] },
      })
    ).toBe("SELECT `id` FROM `User` WHERE `id` = 123 OR `name` = 'abc'");

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { $or: [{ id: 123 }] },
      })
    ).toBe('SELECT `id` FROM `User` WHERE `id` = 123');

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: { $or: [{ id: 123, name: 'abc' }] },
      })
    ).toBe("SELECT `id` FROM `User` WHERE `id` = 123 AND `name` = 'abc'");

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { $or: [{ id: 123 }], name: 'abc' },
      })
    ).toBe("SELECT `id` FROM `User` WHERE `id` = 123 AND `name` = 'abc'");
  }

  shouldFind$orAnd$and() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { creatorId: 1, $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }], id: 1 },
      })
    ).toBe(
      "SELECT `id` FROM `User` WHERE `creatorId` = 1 AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com') AND `id` = 1"
    );

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: {
          creatorId: 1,
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: 1,
          email: 'e',
        },
      })
    ).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = 1' +
        " AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com') AND `id` = 1 AND `email` = 'e'"
    );

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: {
          creatorId: 1,
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: 1,
          email: 'e',
        },
        $sort: { name: 1, createdAt: -1 },
        $skip: 50,
        $limit: 10,
      })
    ).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = 1' +
        " AND (`name` IN ('a', 'b', 'c') OR `email` = 'abc@example.com')" +
        " AND `id` = 1 AND `email` = 'e'" +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50'
    );

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: {
          $or: [
            {
              creatorId: 1,
              id: 1,
              email: 'e',
            },
            { name: ['a', 'b', 'c'], email: 'abc@example.com' },
          ],
        },
        $sort: { name: 1, createdAt: -1 },
        $skip: 50,
        $limit: 10,
      })
    ).toBe(
      "SELECT `id` FROM `User` WHERE (`creatorId` = 1 AND `id` = 1 AND `email` = 'e')" +
        " OR (`name` IN ('a', 'b', 'c') AND `email` = 'abc@example.com')" +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50'
    );
  }

  shouldFindSingle$filter() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: 'some' },
        $limit: 3,
      })
    ).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' LIMIT 3");
  }

  shouldFindMultipleComparisonOperators() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { $or: [{ name: { $eq: 'other', $ne: 'other unwanted' } }, { companyId: 1 }] },
      })
    ).toBe("SELECT `id` FROM `User` WHERE (`name` = 'other' AND `name` <> 'other unwanted') OR `companyId` = 1");

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { createdAt: { $gte: 123, $lte: 999 } },
        $limit: 10,
      })
    ).toBe('SELECT `id` FROM `User` WHERE (`createdAt` >= 123 AND `createdAt` <= 999) LIMIT 10');

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { createdAt: { $gt: 123, $lt: 999 } },
        $limit: 10,
      })
    ).toBe('SELECT `id` FROM `User` WHERE (`createdAt` > 123 AND `createdAt` < 999) LIMIT 10');
  }

  shouldFind$ne() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: 'some', companyId: { $ne: 5 } },
        $limit: 20,
      })
    ).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' AND `companyId` <> 5 LIMIT 20");
  }

  shouldFindIsNull() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { creatorId: 123, companyId: null },
        $limit: 5,
      })
    ).toBe('SELECT `id` FROM `User` WHERE `creatorId` = 123 AND `companyId` IS NULL LIMIT 5');

    expect(
      this.dialect.find(User, {
        $project: { id: true },
        $filter: { creatorId: 123, companyId: { $ne: null } },
        $limit: 5,
      })
    ).toBe('SELECT `id` FROM `User` WHERE `creatorId` = 123 AND `companyId` IS NOT NULL LIMIT 5');
  }

  shouldFind$in() {
    const sql = "SELECT `id` FROM `User` WHERE `name` = 'some' AND `companyId` IN (1, 2, 3) LIMIT 10";
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: 'some', companyId: [1, 2, 3] },
        $limit: 10,
      })
    ).toBe(sql);
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: 'some', companyId: { $in: [1, 2, 3] } },
        $limit: 10,
      })
    ).toBe(sql);
  }

  shouldFind$nin() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: 'some', companyId: { $nin: [1, 2, 3] } },
        $limit: 10,
      })
    ).toBe("SELECT `id` FROM `User` WHERE `name` = 'some' AND `companyId` NOT IN (1, 2, 3) LIMIT 10");
  }

  shouldFind$projectFields() {
    expect(this.dialect.find(User, { $project: { id: true, company: true } })).toBe(
      'SELECT `User`.`id`, `company`.`id` `company.id`, `company`.`companyId` `company.companyId`, `company`.`creatorId` `company.creatorId`' +
        ', `company`.`createdAt` `company.createdAt`, `company`.`updatedAt` `company.updatedAt`' +
        ', `company`.`name` `company.name`, `company`.`description` `company.description`' +
        ' FROM `User` LEFT JOIN `Company` `company` ON `company`.`id` = `User`.`companyId`'
    );
  }

  shouldFind$projectOneToOne() {
    expect(
      this.dialect.find(User, {
        $project: { id: true, name: true, profile: { $project: { id: true, picture: true } } },
      })
    ).toBe(
      'SELECT `User`.`id`, `User`.`name`, `profile`.`pk` `profile.id`, `profile`.`image` `profile.picture` FROM `User`' +
        ' LEFT JOIN `user_profile` `profile` ON `profile`.`creatorId` = `User`.`id`'
    );

    expect(this.dialect.find(User, { $project: { profile: true } })).toBe(
      'SELECT `User`.`id`, `profile`.`companyId` `profile.companyId`' +
        ', `profile`.`creatorId` `profile.creatorId`, `profile`.`createdAt` `profile.createdAt`' +
        ', `profile`.`updatedAt` `profile.updatedAt`' +
        ', `profile`.`pk` `profile.id`, `profile`.`image` `profile.picture`' +
        ' FROM `User` LEFT JOIN `user_profile` `profile` ON `profile`.`creatorId` = `User`.`id`'
    );
  }

  shouldFind$projectManyToOne() {
    expect(
      this.dialect.find(Item, {
        $project: {
          id: true,
          name: true,
          code: true,
          tax: { $project: ['id', 'name'], $required: true },
          measureUnit: { $project: ['id', 'name', 'categoryId'] },
        },
        $limit: 100,
      })
    ).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ' FROM `Item`' +
        ' INNER JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`taxId`' +
        ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LIMIT 100'
    );
  }

  shouldFind$projectWithAllFieldsAndSpecificFieldsAndFilter() {
    expect(
      this.dialect.find(Item, {
        $project: {
          id: true,
          name: true,
          tax: { $project: { id: true, name: true }, $filter: { id: 2 }, $required: true },
          measureUnit: { $project: { id: true, name: true }, $filter: { name: { $ne: 'unidad' } }, $required: true },
        },
        $sort: { 'tax.name': 1, 'measureUnit.name': 1 } as QuerySort<Item>,
        $limit: 100,
      })
    ).toBe(
      'SELECT `Item`.`id`, `Item`.`name`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`' +
        ' FROM `Item`' +
        ' INNER JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`taxId` AND `tax`.`id` = 2' +
        " INNER JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId` AND `measureUnit`.`name` <> 'unidad' AND `measureUnit`.`deletedAt` IS NULL" +
        ' ORDER BY `tax`.`name`, `measureUnit`.`name` LIMIT 100'
    );
  }

  shouldFind$projectDeep() {
    expect(
      this.dialect.find(Item, {
        $project: {
          id: true,
          name: true,
          code: true,
          measureUnit: {
            $project: { id: true, name: true, categoryId: true, category: { $project: ['name'] } },
          },
        },
        $limit: 100,
      })
    ).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `measureUnit`.`id` `measureUnit.id`' +
        ', `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ', `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100'
    );

    expect(
      this.dialect.find(Item, {
        $project: {
          id: true,
          name: true,
          code: true,
          measureUnit: {
            $project: { id: true, name: true, category: { $project: { id: true, name: true } } },
          },
        },
        $limit: 100,
      })
    ).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `measureUnit`.`id` `measureUnit.id`' +
        ', `measureUnit`.`name` `measureUnit.name`, `measureUnit.category`.`id` `measureUnit.category.id`' +
        ', `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100'
    );

    expect(
      this.dialect.find(ItemAdjustment, {
        $project: {
          id: true,
          buyPrice: true,
          number: true,
          item: {
            $project: {
              id: true,
              name: true,
              measureUnit: {
                $project: { id: true, name: true, category: { $project: ['id', 'name'] } },
              },
            },
            $required: true,
          },
        },
        $limit: 100,
      })
    ).toBe(
      'SELECT `ItemAdjustment`.`id`, `ItemAdjustment`.`buyPrice`, `ItemAdjustment`.`number`' +
        ', `item`.`id` `item.id`, `item`.`name` `item.name`' +
        ', `item.measureUnit`.`id` `item.measureUnit.id`, `item.measureUnit`.`name` `item.measureUnit.name`' +
        ', `item.measureUnit.category`.`id` `item.measureUnit.category.id`, `item.measureUnit.category`.`name` `item.measureUnit.category.name`' +
        ' FROM `ItemAdjustment`' +
        ' INNER JOIN `Item` `item` ON `item`.`id` = `ItemAdjustment`.`itemId`' +
        ' LEFT JOIN `MeasureUnit` `item.measureUnit` ON `item.measureUnit`.`id` = `item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `item.measureUnit.category` ON `item.measureUnit.category`.`id` = `item.measureUnit`.`categoryId`' +
        ' LIMIT 100'
    );
  }

  shouldFind$group() {
    expect(
      this.dialect.find(User, {
        $group: ['companyId'],
      })
    ).toBe(
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `name`, `email`, `password` FROM `User` GROUP BY `companyId`'
    );

    expect(
      this.dialect.find(User, {
        $project: ['companyId', raw('COUNT(*)', 'count')],
        $group: ['companyId'],
        $having: {
          count: {
            $gte: 10,
          },
        } as QueryFilter<User>,
      })
    ).toBe('SELECT `companyId`, COUNT(*) `count` FROM `User` GROUP BY `companyId` HAVING `count` >= 10');

    expect(
      this.dialect.find(User, {
        $project: ['id', 'name'],
        $filter: { companyId: 1 },
        $group: ['companyId'],
        $skip: 50,
        $limit: 100,
        $sort: { name: 1 },
      })
    ).toBe(
      'SELECT `id`, `name` FROM `User` WHERE `companyId` = 1 GROUP BY `companyId` ORDER BY `name` LIMIT 100 OFFSET 50'
    );
  }

  shouldFind$limit() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { id: 9 },
        $limit: 1,
      })
    ).toBe('SELECT `id` FROM `User` WHERE `id` = 9 LIMIT 1');

    expect(
      this.dialect.find(User, {
        $project: { id: 1, name: 1, creatorId: 1 },
        $filter: { id: 9 },
        $limit: 1,
      })
    ).toBe('SELECT `id`, `name`, `creatorId` FROM `User` WHERE `id` = 9 LIMIT 1');

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: { name: 'something', creatorId: 123 },
        $limit: 1,
      })
    ).toBe("SELECT `id` FROM `User` WHERE `name` = 'something' AND `creatorId` = 123 LIMIT 1");

    expect(
      this.dialect.find(User, {
        $project: { id: 1, name: 1, creatorId: 1 },
        $limit: 25,
      })
    ).toBe('SELECT `id`, `name`, `creatorId` FROM `User` LIMIT 25');
  }

  shouldFind$skip() {
    expect(
      this.dialect.find(User, {
        $project: { id: 1, name: 1, creatorId: 1 },
        $skip: 30,
      })
    ).toBe('SELECT `id`, `name`, `creatorId` FROM `User` OFFSET 30');
  }

  shouldFind$project() {
    expect(
      this.dialect.find(User, {
        $project: { password: false },
      })
    ).toBe('SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `name`, `email` FROM `User`');

    expect(
      this.dialect.find(User, {
        $project: { name: 0, password: 0 },
      })
    ).toBe('SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `email` FROM `User`');

    expect(
      this.dialect.find(User, {
        $project: { id: 1, name: 1, password: 0 },
      })
    ).toBe('SELECT `id`, `name` FROM `User`');

    expect(
      this.dialect.find(User, {
        $project: { id: 1, name: 0, password: 0 },
      })
    ).toBe('SELECT `id` FROM `User`');

    expect(
      this.dialect.find(User, {
        $project: [raw('*'), raw('LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt', 'hotness')],
        $filter: { name: 'something' },
      })
    ).toBe(
      "SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt `hotness` FROM `User` WHERE `name` = 'something'"
    );
  }

  shouldDelete() {
    expect(this.dialect.delete(User, { $filter: { id: 123 } })).toBe('DELETE FROM `User` WHERE `id` = 123');
    expect(this.dialect.delete(User, { $filter: { id: 123 } }, { force: true })).toBe(
      'DELETE FROM `User` WHERE `id` = 123'
    );
    expect(this.dialect.delete(User, { $filter: { id: 123 } }, { force: false })).toBe(
      'DELETE FROM `User` WHERE `id` = 123'
    );
    expect(this.dialect.delete(MeasureUnit, { $filter: { id: 123 } })).toMatch(
      /^UPDATE `MeasureUnit` SET `deletedAt` = \d+ WHERE `id` = 123 AND `deletedAt` IS NULL$/
    );
    expect(this.dialect.delete(MeasureUnit, { $filter: { id: 123 } }, { force: false })).toMatch(
      /^UPDATE `MeasureUnit` SET `deletedAt` = \d+ WHERE `id` = 123 AND `deletedAt` IS NULL$/
    );
    expect(this.dialect.delete(MeasureUnit, { $filter: { id: 123 } }, { force: true })).toBe(
      'DELETE FROM `MeasureUnit` WHERE `id` = 123'
    );
  }

  shouldRaw() {
    expect(
      this.dialect.find(Item, {
        $project: {
          companyId: true,
          total: raw((prefix, dialect) => `SUM(${prefix}${dialect.escapeId('salePrice')})`),
        },
        $group: ['companyId'],
      })
    ).toBe('SELECT `companyId`, SUM(`salePrice`) `total` FROM `Item` GROUP BY `companyId`');

    expect(
      this.dialect.find(User, {
        $project: ['companyId', raw('COUNT(*)', 'count')],
        $group: ['companyId'],
        $having: {
          count: {
            $gte: 10,
          },
        } as QueryFilter<User>,
      })
    ).toBe('SELECT `companyId`, COUNT(*) `count` FROM `User` GROUP BY `companyId` HAVING `count` >= 10');

    expect(
      this.dialect.find(User, {
        $project: [raw(() => 'createdAt', 'hotness')],
        $filter: { name: 'something' },
      })
    ).toBe("SELECT createdAt `hotness` FROM `User` WHERE `name` = 'something'");

    expect(
      this.dialect.find(User, {
        $project: [raw('*'), raw('LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt', 'hotness')],
        $filter: { name: 'something' },
      })
    ).toBe(
      "SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt `hotness` FROM `User` WHERE `name` = 'something'"
    );
  }

  shouldFind$startsWith() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: { $startsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      })
    ).toBe("SELECT `id` FROM `User` WHERE LOWER(`name`) LIKE 'some%' ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0");

    expect(
      this.dialect.find(User, {
        $project: { id: true },
        $filter: { name: { $startsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      })
    ).toBe(
      "SELECT `id` FROM `User` WHERE (LOWER(`name`) LIKE 'some%' AND `name` <> 'Something') ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0"
    );
  }

  shouldFind$endsWith() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: { $endsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      })
    ).toBe("SELECT `id` FROM `User` WHERE LOWER(`name`) LIKE '%some' ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0");

    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: { $endsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      })
    ).toBe(
      "SELECT `id` FROM `User` WHERE (LOWER(`name`) LIKE '%some' AND `name` <> 'Something') ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0"
    );
  }

  shouldFind$regex() {
    expect(
      this.dialect.find(User, {
        $project: ['id'],
        $filter: { name: { $regex: '^some' } },
      })
    ).toBe("SELECT `id` FROM `User` WHERE `name` REGEXP '^some'");
  }

  shouldFind$text() {
    expect(
      this.dialect.find(Item, {
        $project: { id: true },
        $filter: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      })
    ).toBe("SELECT `id` FROM `Item` WHERE `Item` MATCH 'some text' AND `companyId` = 1 LIMIT 30");

    expect(
      this.dialect.find(User, {
        $project: { id: 1 },
        $filter: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: 1,
        },
        $limit: 10,
      })
    ).toBe(
      "SELECT `id` FROM `User` WHERE `User` MATCH 'something' AND `name` <> 'other unwanted' AND `companyId` = 1 LIMIT 10"
    );
  }
}
