import { expect } from 'vitest';
import {
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  MeasureUnit,
  Profile,
  type Spec,
  Tax,
  TaxCategory,
  User,
} from '../test/index.js';
import type { FieldKey, QueryContext } from '../type/index.js';
import { raw } from '../util/index.js';
import type { AbstractSqlDialect } from './abstractSqlDialect.js';

export abstract class AbstractSqlDialectSpec implements Spec {
  constructor(readonly dialect: AbstractSqlDialect) {}

  protected exec(fn: (ctx: QueryContext) => void): { sql: string; values: unknown[] } {
    const ctx = this.dialect.createContext();
    fn(ctx);
    return { sql: ctx.sql, values: ctx.values };
  }

  shouldBeValidEscapeCharacter() {
    expect(this.dialect.escapeIdChar).toBe('`');
  }

  shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('START TRANSACTION');
  }

  shouldInsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, User, [
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
      ]),
    );
    expect(sql).toBe('INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)');
    expect(values).toEqual([
      'Some name 1',
      'someemail1@example.com',
      123,
      'Some name 2',
      'someemail2@example.com',
      456,
      'Some name 3',
      'someemail3@example.com',
      789,
    ]);
  }

  shouldInsertOne() {
    let res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?)');
    expect(res.values).toEqual(['Some Name', 'someemail@example.com', 123]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, InventoryAdjustment, {
        date: new Date(2021, 11, 31, 23, 59, 59, 999),
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES (?, ?)');
    expect(res.values[0]).toBeInstanceOf(Date);
    expect(res.values[1]).toBe(123);
  }

  shouldInsertWithOnInsertId() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    );
    expect(sql).toMatch(/^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \(\?, \?, \?\)$/);
    expect(values[0]).toBe('Some Name');
    expect(values[1]).toBe(123);
    expect(values[2]).toMatch(/.+/);
  }

  shouldUpdateWithRawString() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: raw("'value'"),
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe("UPDATE `Company` SET `kind` = 'value', `updatedAt` = ? WHERE `id` = ?");
    expect(values).toEqual([123, 1]);
  }

  shouldUpdateWithJsonbField() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: { private: 1 },
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe('UPDATE `Company` SET `kind` = ?, `updatedAt` = ? WHERE `id` = ?');
    expect(values).toEqual(['{"private":1}', 123, 1]);
  }

  shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, [
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
      ]),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \(\?, \?, \?\), \(\?, \?, \?\), \(\?, \?, \?\), \(\?, \?, \?\)$/,
    );
    expect(values[0]).toBe('Some Name A');
    expect(values[2]).toMatch(/.+/);
    expect(values[3]).toBe('Some Name B');
    expect(values[5]).toBe('50');
  }

  shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { email: true },
        {
          name: 'Some Name',
          email: 'someemail@example.com',
          createdAt: 123,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `User` \(.*`name`.*`email`.*`createdAt`.*\) VALUES \(\?, \?, \?, \?\).+ON DUPLICATE KEY UPDATE .*`name` = VALUES\(`name`\).*`createdAt` = VALUES\(`createdAt`\).*`updatedAt` = VALUES\(`updatedAt`\).*$/,
    );
    expect(values).toEqual(['Some Name', 'someemail@example.com', 123, expect.any(Number)]);
  }

  shouldUpdate() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        User,
        { $where: { name: 'some', creatorId: 123 } },
        {
          name: 'Some Text',
          email: 'this field should not be updated',
          updatedAt: 321,
        },
      ),
    );
    expect(sql).toBe('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `name` = ? AND `creatorId` = ?');
    expect(values).toEqual(['Some Text', 321, 'some', 123]);
  }

  shouldUpdateWithAlias() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Profile,
        { $where: { pk: 123 } },
        {
          picture: 'a base64 image',
          updatedAt: 321,
        },
      ),
    );
    expect(sql).toBe('UPDATE `user_profile` SET `image` = ?, `updatedAt` = ? WHERE `pk` = ?');
    expect(values).toEqual(['a base64 image', 321, 123]);
  }

  shouldFind() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { id: 123, name: { $ne: 'abc' } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` <> ?');
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Profile, {
        $select: ['pk', 'picture', 'companyId'],
        $where: { pk: 123, picture: 'abc' },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `pk`, `image` `picture`, `companyId` FROM `user_profile` WHERE `pk` = ? AND `image` = ?',
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnit, {
        $select: ['id'],
        $where: { id: 123, name: 'abc' },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `MeasureUnit` WHERE `id` = ? AND `name` = ? AND `deletedAt` IS NULL');
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldBeSecure() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id', 'something' as FieldKey<User>],
        $where: {
          id: 1,
          something: 1,
        } as any,
        $sort: {
          id: 1,
          something: 1,
        } as any,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `something` = ? ORDER BY `id`, `something`');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        something: 'anything',
        createdAt: 1,
      } as any),
    );
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `createdAt`) VALUES (?, ?)');
    expect(res.values).toEqual(['Some Name', 1]);

    res = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        User,
        {
          $where: { something: 'anything' },
        },
        {
          name: 'Some Name',
          something: 'anything',
          updatedAt: 1,
        } as any,
      ),
    );
    expect(res.sql).toBe('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `something` = ?');
    expect(res.values).toEqual(['Some Name', 1, 'anything']);

    res = this.exec((ctx) =>
      this.dialect.delete(ctx, User, {
        $where: { something: 'anything' } as any,
      }),
    );
    expect(res.sql).toBe('DELETE FROM `User` WHERE `something` = ?');
    expect(res.values).toEqual(['anything']);
  }

  shouldFind$and() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $and: [{ id: 123, name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` = ?');
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: { $and: [{ id: 123 }], name: 'abc' },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` = ?');
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldFind$or() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $or: [{ id: 123 }, { name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? OR `name` = ?');
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $or: [{ id: 123 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ?');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: { $or: [{ id: 123, name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` = ?');
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $or: [{ id: 123 }], name: 'abc' },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` = ?');
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldFind$not() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $not: [{ name: 'Some' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT `name` = ?');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: ['id'],
        $where: { id: { $not: 123 } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT (`id` = ?)');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: ['id'],
        $where: { id: { $not: [123, 456] } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT (`id` IN (?, ?))');
    expect(res.values).toEqual([123, 456]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: ['id'],
        $where: { id: 123, name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE `id` = ? AND NOT (`name` LIKE ?)');
    expect(res.values).toEqual([123, 'a%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: ['id'],
        $where: { name: { $not: { $startsWith: 'a', $endsWith: 'z' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT ((`name` LIKE ? AND `name` LIKE ?))');
    expect(res.values).toEqual(['a%', '%z']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: { $like: 'Some', $ne: 'Something' } }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT (`name` LIKE ? AND `name` <> ?)');
    expect(res.values).toEqual(['Some', 'Something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: 'abc' }, { creatorId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT (`name` = ? AND `creatorId` = ?)');
    expect(res.values).toEqual(['abc', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Tax, {
        $select: ['id'],
        $where: { companyId: 1, name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Tax` WHERE `companyId` = ? AND NOT (`name` LIKE ?)');
    expect(res.values).toEqual([1, 'a%']);
  }

  shouldFind$nor() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $nor: [{ name: 'Some' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT `name` = ?');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $nor: [{ name: { $like: 'Some', $ne: 'Something' } }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT (`name` LIKE ? AND `name` <> ?)');
    expect(res.values).toEqual(['Some', 'Something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $nor: [{ name: 'abc' }, { creatorId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT (`name` = ? OR `creatorId` = ?)');
    expect(res.values).toEqual(['abc', 1]);
  }

  shouldFind$orAnd$and() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { creatorId: 1, $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }], id: 1 },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ? AND (`name` IN (?, ?, ?) OR `email` = ?) AND `id` = ?',
    );
    expect(res.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1]);

    const res2 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: {
          creatorId: 1,
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: 1,
          email: 'e',
        },
      }),
    );
    expect(res2.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ?' +
        ' AND (`name` IN (?, ?, ?) OR `email` = ?) AND `id` = ? AND `email` = ?',
    );
    expect(res2.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1, 'e']);

    const res3 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: {
          creatorId: 1,
          $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }],
          id: 1,
          email: 'e',
        },
        $sort: { name: 1, createdAt: -1 },
        $skip: 50,
        $limit: 10,
      }),
    );
    expect(res3.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ?' +
        ' AND (`name` IN (?, ?, ?) OR `email` = ?)' +
        ' AND `id` = ? AND `email` = ?' +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50',
    );
    expect(res3.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1, 'e']);

    const res4 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: {
          $or: [
            {
              creatorId: 1,
              id: 1,
              email: 'e',
            },
            { name: ['a', 'b', 'c'], email: 'abc@example.com' },
          ],
        },
        $sort: [
          { field: 'name', sort: 'asc' },
          { field: 'createdAt', sort: 'desc' },
        ],
        $skip: 50,
        $limit: 10,
      }),
    );
    expect(res4.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`creatorId` = ? AND `id` = ? AND `email` = ?)' +
        ' OR (`name` IN (?, ?, ?) AND `email` = ?)' +
        ' ORDER BY `name`, `createdAt` DESC LIMIT 10 OFFSET 50',
    );
    expect(res4.values).toEqual([1, 1, 'e', 'a', 'b', 'c', 'abc@example.com']);
  }

  shouldFindSingle$where() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: 'some' },
        $limit: 3,
      }),
    );
    expect(sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? LIMIT 3');
    expect(values).toEqual(['some']);
  }

  shouldFindMultipleComparisonOperators() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { $or: [{ name: { $eq: 'other', $ne: 'other unwanted' } }, { companyId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE (`name` = ? AND `name` <> ?) OR `companyId` = ?');
    expect(res.values).toEqual(['other', 'other unwanted', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { createdAt: { $gte: 123, $lte: 999 } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE (`createdAt` >= ? AND `createdAt` <= ?) LIMIT 10');
    expect(res.values).toEqual([123, 999]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { createdAt: { $gt: 123, $lt: 999 } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE (`createdAt` > ? AND `createdAt` < ?) LIMIT 10');
    expect(res.values).toEqual([123, 999]);
  }

  shouldFind$ne() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: 'some', companyId: { $ne: 5 } },
        $limit: 20,
      }),
    );
    expect(sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` <> ? LIMIT 20');
    expect(values).toEqual(['some', 5]);
  }

  shouldFindIsNull() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { creatorId: 123, companyId: null },
        $limit: 5,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `creatorId` = ? AND `companyId` IS NULL LIMIT 5');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { creatorId: 123, companyId: { $ne: null } },
        $limit: 5,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `creatorId` = ? AND `companyId` IS NOT NULL LIMIT 5');
    expect(res.values).toEqual([123]);
  }

  shouldFind$in() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: 'some', companyId: [1, 2, 3] },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` IN (?, ?, ?) LIMIT 10');
    expect(res.values).toEqual(['some', 1, 2, 3]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: 'some', companyId: { $in: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` IN (?, ?, ?) LIMIT 10');
    expect(res.values).toEqual(['some', 1, 2, 3]);
  }

  shouldFind$nin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: 'some', companyId: { $nin: [1, 2, 3] } },
        $limit: 10,
      }),
    );
    expect(sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` NOT IN (?, ?, ?) LIMIT 10');
    expect(values).toEqual(['some', 1, 2, 3]);
  }

  shouldFind$selectFields() {
    const { sql } = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: true, company: true } }));
    expect(sql).toBe(
      'SELECT `User`.`id`, `company`.`id` `company_id`, `company`.`companyId` `company_companyId`, `company`.`creatorId` `company_creatorId`' +
        ', `company`.`createdAt` `company_createdAt`, `company`.`updatedAt` `company_updatedAt`' +
        ', `company`.`name` `company_name`, `company`.`description` `company_description`, `company`.`kind` `company_kind`' +
        ' FROM `User` LEFT JOIN `Company` `company` ON `company`.`id` = `User`.`companyId`',
    );
  }

  shouldFind$selectOneToOne() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, { $select: { id: true, name: true, profile: ['id', 'picture'] } }),
    );
    expect(res.sql).toBe(
      'SELECT `User`.`id`, `User`.`name`, `profile`.`pk` `profile_pk`, `profile`.`image` `profile_picture` FROM `User`' +
        ' LEFT JOIN `user_profile` `profile` ON `profile`.`creatorId` = `User`.`id`',
    );

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { profile: true } }));
    expect(res.sql).toBe(
      'SELECT `User`.`id`, `profile`.`companyId` `profile_companyId`' +
        ', `profile`.`creatorId` `profile_creatorId`, `profile`.`createdAt` `profile_createdAt`' +
        ', `profile`.`updatedAt` `profile_updatedAt`' +
        ', `profile`.`pk` `profile_pk`, `profile`.`image` `profile_picture`' +
        ' FROM `User` LEFT JOIN `user_profile` `profile` ON `profile`.`creatorId` = `User`.`id`',
    );
  }

  shouldFind$selectManyToOne() {
    const { sql } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
          code: true,
          tax: { $select: ['id', 'name'], $required: true },
          measureUnit: { $select: ['id', 'name', 'categoryId'] },
        },
        $limit: 100,
      }),
    );
    expect(sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', `tax`.`id` `tax_id`, `tax`.`name` `tax_name`' +
        ', `measureUnit`.`id` `measureUnit_id`, `measureUnit`.`name` `measureUnit_name`, `measureUnit`.`categoryId` `measureUnit_categoryId`' +
        ' FROM `Item`' +
        ' INNER JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`taxId`' +
        ' LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LIMIT 100',
    );
  }

  shouldFind$selectWithAllFieldsAndSpecificFieldsAndWhere() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
          measureUnit: { $select: ['id', 'name'], $where: { name: { $ne: 'unidad' } }, $required: true },
          tax: ['id', 'name'],
        },
        $where: { salePrice: { $gte: 1000 }, name: { $istartsWith: 'A' } },
        $sort: { tax: { name: 1 }, measureUnit: { name: 1 }, createdAt: -1 },
        $limit: 100,
      }),
    );
    expect(sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`' +
        ', `measureUnit`.`id` `measureUnit_id`, `measureUnit`.`name` `measureUnit_name`' +
        ', `tax`.`id` `tax_id`, `tax`.`name` `tax_name`' +
        ' FROM `Item`' +
        ' INNER JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId` AND `measureUnit`.`name` <> ? AND `measureUnit`.`deletedAt` IS NULL' +
        ' LEFT JOIN `Tax` `tax` ON `tax`.`id` = `Item`.`taxId`' +
        ' WHERE `Item`.`salePrice` >= ? AND `Item`.`name` LIKE ?' +
        ' ORDER BY `tax`.`name`, `measureUnit`.`name`, `Item`.`createdAt` DESC LIMIT 100',
    );
    expect(values).toEqual(['unidad', 1000, 'a%']);
  }

  shouldVirtualField() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: 1,
        },
        $where: {
          tagsCount: { $gte: 10 },
        },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `Item` WHERE (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `id`) >= ?',
    );
    expect(res.values).toEqual([10]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: 1,
          name: 1,
          code: 1,
          tagsCount: 1,
          measureUnit: {
            $select: { id: 1, name: 1, categoryId: 1, category: ['name'] },
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) `tagsCount`' +
        ', `measureUnit`.`id` `measureUnit_id`, `measureUnit`.`name` `measureUnit_name`, `measureUnit`.`categoryId` `measureUnit_categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit_category_id`, `measureUnit.category`.`name` `measureUnit_category_name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100',
    );
  }

  shouldFind$selectDeep() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: 1,
          name: 1,
          code: 1,
          measureUnit: {
            $select: { id: 1, name: 1, categoryId: 1, category: ['name'] },
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', `measureUnit`.`id` `measureUnit_id`' +
        ', `measureUnit`.`name` `measureUnit_name`, `measureUnit`.`categoryId` `measureUnit_categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit_category_id`, `measureUnit.category`.`name` `measureUnit_category_name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100',
    );

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: {
          id: true,
          name: true,
          code: true,
          measureUnit: {
            $select: { id: true, name: true, category: { $select: { id: true, name: true } } },
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `measureUnit`.`id` `measureUnit_id`' +
        ', `measureUnit`.`name` `measureUnit_name`, `measureUnit.category`.`id` `measureUnit_category_id`' +
        ', `measureUnit.category`.`name` `measureUnit_category_name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100',
    );

    res = this.exec((ctx) =>
      this.dialect.find(ctx, ItemAdjustment, {
        $select: {
          id: true,
          buyPrice: true,
          number: true,
          item: {
            $select: {
              id: true,
              name: true,
              measureUnit: {
                $select: { id: true, name: true, category: ['id', 'name'] },
              },
            },
            $required: true,
          },
        },
        $limit: 100,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `ItemAdjustment`.`id`, `ItemAdjustment`.`buyPrice`, `ItemAdjustment`.`number`' +
        ', `item`.`id` `item_id`, `item`.`name` `item_name`' +
        ', `item.measureUnit`.`id` `item_measureUnit_id`, `item.measureUnit`.`name` `item_measureUnit_name`' +
        ', `item.measureUnit.category`.`id` `item_measureUnit_category_id`, `item.measureUnit.category`.`name` `item_measureUnit_category_name`' +
        ' FROM `ItemAdjustment`' +
        ' INNER JOIN `Item` `item` ON `item`.`id` = `ItemAdjustment`.`itemId`' +
        ' LEFT JOIN `MeasureUnit` `item.measureUnit` ON `item.measureUnit`.`id` = `item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `item.measureUnit.category` ON `item.measureUnit.category`.`id` = `item.measureUnit`.`categoryId`' +
        ' LIMIT 100',
    );
  }

  shouldFind$limit() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: 9,
        $limit: 1,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? LIMIT 1');
    expect(res.values).toEqual([9]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1, name: 1, creatorId: 1 },
        $where: 9,
        $limit: 1,
      }),
    );
    expect(res.sql).toBe('SELECT `id`, `name`, `creatorId` FROM `User` WHERE `id` = ? LIMIT 1');
    expect(res.values).toEqual([9]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: 'something', creatorId: 123 },
        $limit: 1,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `creatorId` = ? LIMIT 1');
    expect(res.values).toEqual(['something', 123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id', 'name', 'creatorId'],
        $limit: 25,
      }),
    );
    expect(res.sql).toBe('SELECT `id`, `name`, `creatorId` FROM `User` LIMIT 25');
  }

  shouldFind$skip() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1, name: 1, creatorId: 1 },
        $skip: 30,
      }),
    );
    expect(res.sql).toBe('SELECT `id`, `name`, `creatorId` FROM `User` OFFSET 30');
  }

  shouldFind$select() {
    let res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { password: false } }));
    expect(res.sql).toBe(
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `name`, `email` FROM `User`',
    );

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { name: 0, password: 0 } }));
    expect(res.sql).toBe('SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `email` FROM `User`');

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: 1, name: 1, password: 0 } }));
    expect(res.sql).toBe('SELECT `id`, `name` FROM `User`');

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { id: 1, name: 0, password: 0 } }));
    expect(res.sql).toBe('SELECT `id` FROM `User`');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw('*'), raw('LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt', 'hotness')],
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe(
      'SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt `hotness` FROM `User` WHERE `name` = ?',
    );
    expect(res.values).toEqual(['something']);
  }

  shouldDelete() {
    let res = this.exec((ctx) => this.dialect.delete(ctx, User, { $where: 123 }));
    expect(res.sql).toBe('DELETE FROM `User` WHERE `id` = ?');
    expect(res.values).toEqual([123]);

    expect(() => this.exec((ctx) => this.dialect.delete(ctx, User, { $where: 123 }, { softDelete: true }))).toThrow(
      "'User' has not enabled 'softDelete'",
    );

    res = this.exec((ctx) => this.dialect.delete(ctx, User, { $where: 123 }, { softDelete: false }));
    expect(res.sql).toBe('DELETE FROM `User` WHERE `id` = ?');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) => this.dialect.delete(ctx, MeasureUnit, { $where: 123 }));
    expect(res.sql).toMatch(/^UPDATE `MeasureUnit` SET `deletedAt` = \? WHERE `id` = \? AND `deletedAt` IS NULL$/);
    expect(res.values).toEqual([expect.any(Number), 123]);

    res = this.exec((ctx) => this.dialect.delete(ctx, MeasureUnit, { $where: 123 }, { softDelete: true }));
    expect(res.sql).toMatch(/^UPDATE `MeasureUnit` SET `deletedAt` = \? WHERE `id` = \? AND `deletedAt` IS NULL$/);
    expect(res.values).toEqual([expect.any(Number), 123]);

    res = this.exec((ctx) => this.dialect.delete(ctx, MeasureUnit, { $where: 123 }, { softDelete: false }));
    expect(res.sql).toBe('DELETE FROM `MeasureUnit` WHERE `id` = ?');
    expect(res.values).toEqual([123]);
  }

  shouldFind$selectRaw() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw(() => 'createdAt', 'hotness')],
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe('SELECT createdAt `hotness` FROM `User` WHERE `name` = ?');
    expect(res.values).toEqual(['something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw('*'), raw('LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt', 'hotness')],
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe(
      'SELECT *, LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt `hotness` FROM `User` WHERE `name` = ?',
    );
    expect(res.values).toEqual(['something']);
  }

  shouldFind$whereRaw() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['creatorId'],
        $where: { $and: [{ companyId: 1 }, raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `creatorId` FROM `Item` WHERE `companyId` = ? AND SUM(salePrice) > 500');
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['id'],
        $where: { $or: [{ companyId: 1 }, 5, raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `companyId` = ? OR `id` = ? OR SUM(salePrice) > 500');
    expect(res.values).toEqual([1, 5]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['id'],
        $where: { $or: [1, raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `id` = ? OR SUM(salePrice) > 500');
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['id'],
        $where: { $or: [raw('SUM(salePrice) > 500'), 1, { companyId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500 OR `id` = ? OR `companyId` = ?');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['id'],
        $where: { $and: [raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['id'],
        $where: raw('SUM(salePrice) > 500'),
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: ['creatorId'],
        $where: { $or: [[1, 2], { code: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `creatorId` FROM `Item` WHERE `id` IN (?, ?) OR `code` = ?');
    expect(res.values).toEqual([1, 2, 'abc']);
  }

  shouldFind$startsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $startsWith: 'Some' } },
        $sort: [
          { field: 'name', sort: 'asc' },
          { field: 'createdAt', sort: 'desc' },
        ],
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `createdAt` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['Some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $startsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['Some%', 'Something']);
  }

  shouldFind$istartsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $istartsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $istartsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['some%', 'Something']);
  }

  shouldFind$endsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $endsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['%Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $endsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%Some', 'Something']);
  }

  shouldFind$iendsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $iendsWith: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['%some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $iendsWith: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%some', 'Something']);
  }

  shouldFind$includes() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $includes: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['%Some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $includes: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%Some%', 'Something']);
  }

  shouldFind$iincludes() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $iincludes: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['%some%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $iincludes: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['%some%', 'Something']);
  }

  shouldFind$like() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $like: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $like: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['Some', 'Something']);
  }

  shouldFind$ilike() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $ilike: 'Some' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` LIKE ? ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0');
    expect(res.values).toEqual(['some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: { name: { $ilike: 'Some', $ne: 'Something' } },
        $sort: { name: 1, id: -1 },
        $skip: 0,
        $limit: 50,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE (`name` LIKE ? AND `name` <> ?) ORDER BY `name`, `id` DESC LIMIT 50 OFFSET 0',
    );
    expect(res.values).toEqual(['some', 'Something']);
  }

  shouldFind$regex() {
    const res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: ['id'],
        $where: { name: { $regex: '^some' } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` REGEXP ?');
    expect(res.values).toEqual(['^some']);
  }

  shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `Item` WHERE MATCH(`name`, `description`) AGAINST(?) AND `companyId` = ? LIMIT 30',
    );
    expect(res.values).toEqual(['some text', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: 1 },
        $where: {
          $text: { $fields: ['name'], $value: 'something' },
          name: { $ne: 'other unwanted' },
          companyId: 1,
        },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE MATCH(`name`) AGAINST(?) AND `name` <> ? AND `companyId` = ? LIMIT 10',
    );
    expect(res.values).toEqual(['something', 'other unwanted', 1]);
  }

  shouldUpdateWithJsonNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.update(
        ctx,
        Company,
        { $where: { id: 1 } },
        {
          kind: null,
          updatedAt: 123,
        },
      ),
    );
    expect(sql).toBe('UPDATE `Company` SET `kind` = ?, `updatedAt` = ? WHERE `id` = ?');
    expect(values).toEqual([null, 123, 1]);
  }

  shouldHandleRawFalsyValues() {
    const { sql } = this.exec((ctx) => {
      this.dialect.selectFields(ctx, User, [raw(() => 0, 'zero')]);
    });
    expect(sql).toBe('0 `zero`');

    const { sql: sql2 } = this.exec((ctx) => {
      this.dialect.selectFields(ctx, User, [raw(() => '', 'empty')]);
    });
    expect(sql2).toBe(' `empty`');
  }

  shouldHandleEmptyAppend() {
    const ctx = this.dialect.createContext();
    ctx.append('SELECT ').append('').append('*');
    expect(ctx.sql).toBe('SELECT *');
  }
}
