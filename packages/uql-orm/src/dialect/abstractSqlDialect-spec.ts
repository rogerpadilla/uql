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
import type { QueryContext } from '../type/index.js';
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

  shouldGetBeginTransactionStatementsWithoutIsolationLevel() {
    expect(this.dialect.getBeginTransactionStatements()).toEqual([this.dialect.beginTransactionCommand]);
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

  shouldUpsertMany() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(ctx, User, { email: true }, [
        {
          name: 'Name A',
          email: 'a@example.com',
          createdAt: 100,
        },
        {
          name: 'Name B',
          email: 'b@example.com',
          createdAt: 200,
        },
      ]),
    );
    expect(sql).toMatch(/^INSERT INTO `User` .*VALUES \(\?, \?, \?, \?\), \(\?, \?, \?, \?\).+ON DUPLICATE KEY UPDATE/);
    expect(values).toHaveLength(8);
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
        $select: { id: true },
        $where: { id: 123, name: { $ne: 'abc' } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` <> ?');
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Profile, {
        $select: { pk: true, picture: true, companyId: true },
        $where: { pk: 123, picture: 'abc' },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `pk`, `image` `picture`, `companyId` FROM `user_profile` WHERE `pk` = ? AND `image` = ?',
    );
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, MeasureUnit, {
        $select: { id: true },
        $where: { id: 123, name: 'abc' },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `MeasureUnit` WHERE `id` = ? AND `name` = ? AND `deletedAt` IS NULL');
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldBeSecure() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, something: true } as any,
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
          $where: { something: 'anything' } as any,
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
        $select: { id: true },
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
        $select: { id: true },
        $where: { $or: [{ id: 123 }, { name: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? OR `name` = ?');
    expect(res.values).toEqual([123, 'abc']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
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
        $select: { id: true },
        $where: { $or: [{ id: 123 }], name: 'abc' },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `id` = ? AND `name` = ?');
    expect(res.values).toEqual([123, 'abc']);
  }

  shouldFind$not() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { $not: [{ name: 'Some' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE NOT `name` = ?');
    expect(res.values).toEqual(['Some']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: { $not: 123 } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT (`id` = ?)');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: { $not: [123, 456] } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE NOT (`id` IN (?, ?))');
    expect(res.values).toEqual([123, 456]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
        $where: { id: 123, name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Company` WHERE `id` = ? AND NOT (`name` LIKE ?)');
    expect(res.values).toEqual([123, 'a%']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Company, {
        $select: { id: true },
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
        $select: { id: true },
        $where: { companyId: 1, name: { $not: { $startsWith: 'a' } } },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Tax` WHERE `companyId` = ? AND NOT (`name` LIKE ?)');
    expect(res.values).toEqual([1, 'a%']);
  }

  shouldFind$nor() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
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
        $select: { id: true },
        $where: { creatorId: 1, $or: [{ name: ['a', 'b', 'c'] }, { email: 'abc@example.com' }], id: 1 },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `User` WHERE `creatorId` = ? AND (`name` IN (?, ?, ?) OR `email` = ?) AND `id` = ?',
    );
    expect(res.values).toEqual([1, 'a', 'b', 'c', 'abc@example.com', 1]);

    const res2 = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $sort: { name: 'asc', createdAt: 'desc' },
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
        $select: { id: true },
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
        $select: { id: true },
        $where: { $or: [{ name: { $eq: 'other', $ne: 'other unwanted' } }, { companyId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE (`name` = ? AND `name` <> ?) OR `companyId` = ?');
    expect(res.values).toEqual(['other', 'other unwanted', 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { createdAt: { $gte: 123, $lte: 999 } },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE (`createdAt` >= ? AND `createdAt` <= ?) LIMIT 10');
    expect(res.values).toEqual([123, 999]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
        $where: { creatorId: 123, companyId: null as any },
        $limit: 5,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `creatorId` = ? AND `companyId` IS NULL LIMIT 5');
    expect(res.values).toEqual([123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
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
        $select: { id: true },
        $where: { name: 'some', companyId: [1, 2, 3] },
        $limit: 10,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `companyId` IN (?, ?, ?) LIMIT 10');
    expect(res.values).toEqual(['some', 1, 2, 3]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
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
        $select: { id: true },
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
      'SELECT `User`.`id`, `company`.`id` `company.id`, `company`.`companyId` `company.companyId`, `company`.`creatorId` `company.creatorId`' +
        ', `company`.`createdAt` `company.createdAt`, `company`.`updatedAt` `company.updatedAt`' +
        ', `company`.`name` `company.name`, `company`.`description` `company.description`, `company`.`kind` `company.kind`' +
        ' FROM `User` LEFT JOIN `Company` `company` ON `company`.`id` = `User`.`companyId`',
    );
  }

  shouldFind$selectOneToOne() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, name: true, profile: { $select: { id: true, picture: true } } },
      }),
    );
    expect(res.sql).toBe(
      'SELECT `User`.`id`, `User`.`name`, `profile`.`pk` `profile.pk`, `profile`.`image` `profile.picture` FROM `User`' +
        ' LEFT JOIN `user_profile` `profile` ON `profile`.`creatorId` = `User`.`id`',
    );

    res = this.exec((ctx) => this.dialect.find(ctx, User, { $select: { profile: true } }));
    expect(res.sql).toBe(
      'SELECT `User`.`id`, `User`.`companyId`, `User`.`creatorId`, `User`.`createdAt`' +
        ', `User`.`updatedAt`, `User`.`name`, `User`.`email`' +
        ', `profile`.`companyId` `profile.companyId`' +
        ', `profile`.`creatorId` `profile.creatorId`, `profile`.`createdAt` `profile.createdAt`' +
        ', `profile`.`updatedAt` `profile.updatedAt`' +
        ', `profile`.`pk` `profile.pk`, `profile`.`image` `profile.picture`' +
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
          tax: { $select: { id: true, name: true }, $required: true },
          measureUnit: { $select: { id: true, name: true, categoryId: true } },
        },
        $limit: 100,
      }),
    );
    expect(sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
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
          measureUnit: { $select: { id: true, name: true }, $where: { name: { $ne: 'unidad' } }, $required: true },
          tax: ['id', 'name'] as any,
        },
        $where: { salePrice: { $gte: 1000 }, name: { $istartsWith: 'A' } },
        $sort: { tax: { name: 1 }, measureUnit: { name: 1 }, createdAt: -1 },
        $limit: 100,
      }),
    );
    expect(sql).toBe(
      'SELECT `Item`.`id`, `Item`.`name`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`' +
        ', `tax`.`id` `tax.id`, `tax`.`name` `tax.name`' +
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
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
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
        ', `measureUnit`.`id` `measureUnit.id`' +
        ', `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
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
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`, `measureUnit`.`id` `measureUnit.id`' +
        ', `measureUnit`.`name` `measureUnit.name`, `measureUnit.category`.`id` `measureUnit.category.id`' +
        ', `measureUnit.category`.`name` `measureUnit.category.name`' +
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
        ', `item`.`id` `item.id`, `item`.`name` `item.name`' +
        ', `item.measureUnit`.`id` `item.measureUnit.id`, `item.measureUnit`.`name` `item.measureUnit.name`' +
        ', `item.measureUnit.category`.`id` `item.measureUnit.category.id`, `item.measureUnit.category`.`name` `item.measureUnit.category.name`' +
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
        $select: { id: true },
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
        $select: { id: true },
        $where: { name: 'something', creatorId: 123 },
        $limit: 1,
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `User` WHERE `name` = ? AND `creatorId` = ? LIMIT 1');
    expect(res.values).toEqual(['something', 123]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true, name: true, creatorId: true },
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
        $select: [raw('*'), raw('LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt', 'hotness')] as any,
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
        $select: [raw(() => 'createdAt', 'hotness')] as any,
        $where: { name: 'something' },
      }),
    );
    expect(res.sql).toBe('SELECT createdAt `hotness` FROM `User` WHERE `name` = ?');
    expect(res.values).toEqual(['something']);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: [raw('*'), raw('LOG10(numberOfVotes + 1) * 287014.5873982681 + createdAt', 'hotness')] as any,
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
        $select: { creatorId: true },
        $where: { $and: [{ companyId: 1 }, raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `creatorId` FROM `Item` WHERE `companyId` = ? AND SUM(salePrice) > 500');
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [{ companyId: 1 }, { id: 5 }, raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `companyId` = ? OR `id` = ? OR SUM(salePrice) > 500');
    expect(res.values).toEqual([1, 5]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [{ id: 1 }, raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE `id` = ? OR SUM(salePrice) > 500');
    expect(res.values).toEqual([1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $or: [raw('SUM(salePrice) > 500'), { id: 1 }, { companyId: 1 }] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500 OR `id` = ? OR `companyId` = ?');
    expect(res.values).toEqual([1, 1]);

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $and: [raw('SUM(salePrice) > 500')] },
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: raw('SUM(salePrice) > 500'),
      }),
    );
    expect(res.sql).toBe('SELECT `id` FROM `Item` WHERE SUM(salePrice) > 500');

    res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { creatorId: true },
        $where: { $or: [{ id: { $in: [1, 2] } }, { code: 'abc' }] },
      }),
    );
    expect(res.sql).toBe('SELECT `creatorId` FROM `Item` WHERE `id` IN (?, ?) OR `code` = ?');
    expect(res.values).toEqual([1, 2, 'abc']);
  }

  shouldFind$startsWith() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { id: true },
        $where: { name: { $startsWith: 'Some' } },
        $sort: { name: 'asc', createdAt: 'desc' },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
        $select: { id: true },
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
          kind: null as any,
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

  // Aggregate tests — shared across all SQL dialects
  shouldAggregateGroupByWithCount() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
      }),
    );
    expect(sql).toBe(`SELECT ${e}status${e}, COUNT(*) ${e}count${e} FROM ${e}User${e} GROUP BY ${e}status${e}`);
    expect(values).toEqual([]);
  }

  shouldAggregateGroupByWithMultipleFunctions() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
          avgCreated: { $avg: 'createdAt' },
          maxCreated: { $max: 'createdAt' },
          minCreated: { $min: 'createdAt' },
        },
      }),
    );
    expect(sql).toBe(
      `SELECT ${e}status${e}, COUNT(*) ${e}count${e}, AVG(${e}createdAt${e}) ${e}avgCreated${e}, MAX(${e}createdAt${e}) ${e}maxCreated${e}, MIN(${e}createdAt${e}) ${e}minCreated${e} FROM ${e}User${e} GROUP BY ${e}status${e}`,
    );
    expect(values).toEqual([]);
  }

  shouldAggregateWithHaving() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $having: { count: { $gt: 5 } },
      }),
    );
    expect(sql).toContain(`GROUP BY ${e}status${e} HAVING COUNT(*) > `);
    expect(values).toEqual([5]);
  }

  shouldAggregateWithHavingMultipleConditions() {
    const { values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
          total: { $sum: 'createdAt' },
        },
        $having: {
          count: { $gte: 2 },
          total: { $lt: 1000 },
        },
      }),
    );
    expect(values).toEqual([2, 1000]);
  }

  shouldAggregateWithWhereAndSort() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $where: { name: { $ne: null } },
        $sort: { count: -1 },
        $limit: 10,
      }),
    );
    expect(sql).toContain(`${e}name${e} IS NOT NULL`);
    expect(sql).toContain('ORDER BY COUNT(*) DESC LIMIT 10');
    expect(values).toEqual([]);
  }

  shouldAggregateTotalWithoutGroupBy() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          total: { $count: '*' },
          maxCreated: { $max: 'createdAt' },
        },
      }),
    );
    expect(sql).toBe(`SELECT COUNT(*) ${e}total${e}, MAX(${e}createdAt${e}) ${e}maxCreated${e} FROM ${e}User${e}`);
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingBetween() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $having: { count: { $between: [2, 10] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) BETWEEN ');
    expect(values).toEqual([2, 10]);
  }

  shouldAggregateWithHavingExactValue() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $having: { count: 5 },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) = ');
    expect(values).toEqual([5]);
  }

  shouldAggregateSortByAliasInsteadOfField() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
          total: { $sum: 'createdAt' },
        },
        $sort: { count: -1, status: 1 },
      }),
    );
    // `count` should resolve to the aggregate expression COUNT(*), not a column name
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
    expect(sql).toContain('GROUP BY');
  }

  // $distinct tests — shared across all SQL dialects
  shouldFindDistinct() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { name: true },
        $distinct: true,
      }),
    );
    expect(sql).toBe(`SELECT DISTINCT ${e}name${e} FROM ${e}User${e}`);
    expect(values).toEqual([]);
  }

  shouldFindDistinctWithWhereAndSort() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.find(ctx, User, {
        $select: { name: true, email: true },
        $distinct: true,
        $where: { name: { $ne: null } },
        $sort: { name: 1 },
        $limit: 50,
      }),
    );
    expect(sql).toContain('SELECT DISTINCT');
    expect(sql).toContain('IS NOT NULL');
    expect(sql).toContain('LIMIT 50');
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingIn() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $having: { count: { $in: [1, 5, 10] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) IN (');
    expect(values).toEqual([1, 5, 10]);
  }

  shouldAggregateWithHavingNin() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $having: { count: { $nin: [0, 999] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) NOT IN (');
    expect(values).toEqual([0, 999]);
  }

  shouldAggregateWithHavingInEmpty() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $having: { count: { $in: [] } },
      }),
    );
    expect(sql).toContain('HAVING COUNT(*) IN (NULL)');
  }

  shouldAggregateWithHavingIsNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          maxVal: { $max: 'createdAt' },
        },
        $having: { maxVal: { $isNull: true } },
      }),
    );
    expect(sql).toContain('HAVING MAX(');
    expect(sql).toContain(' IS NULL');
    expect(values).toEqual([]);
  }

  shouldAggregateWithHavingIsNotNull() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          maxVal: { $max: 'createdAt' },
        },
        $having: { maxVal: { $isNotNull: true } },
      }),
    );
    expect(sql).toContain('HAVING MAX(');
    expect(sql).toContain(' IS NOT NULL');
    expect(values).toEqual([]);
  }

  shouldAggregateSortWithNumericNegativeOne() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $sort: { count: -1 },
      }),
    );
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
  }

  shouldAggregateSortWithMixedDirections() {
    const { sql } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
          total: { $sum: 'createdAt' },
        },
        $sort: { count: 'desc', status: 'asc', total: 1 },
      }),
    );
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
    expect(sql).toContain('SUM(');
    expect(sql).not.toContain('SUM(' + this.dialect.escapeIdChar + 'createdAt' + this.dialect.escapeIdChar + ') DESC');
  }

  shouldAggregateWithPagination() {
    const e = this.dialect.escapeIdChar;
    const { sql, values } = this.exec((ctx) =>
      this.dialect.aggregate(ctx, User, {
        $group: {
          status: true,
          count: { $count: '*' },
        },
        $sort: { count: -1 },
        $skip: 20,
        $limit: 10,
      }),
    );
    expect(sql).toContain(`GROUP BY ${e}status${e}`);
    expect(sql).toContain('ORDER BY COUNT(*) DESC');
    expect(sql).toContain('LIMIT 10');
    expect(sql).toContain('OFFSET 20');
    expect(values).toEqual([]);
  }
}
