import { expect } from 'bun:test';
import { AbstractSqlDialectSpec } from '../dialect/abstractSqlDialect-spec.js';
import { Company, createSpec, InventoryAdjustment, Item, ItemTag, Profile, TaxCategory, User } from '../test/index.js';
import { SqliteDialect } from './sqliteDialect.js';

class SqliteDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new SqliteDialect());
  }

  override shouldBeginTransaction() {
    expect(this.dialect.beginTransactionCommand).toBe('BEGIN TRANSACTION');
  }

  override shouldUpsert() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        TaxCategory,
        { pk: true },
        {
          pk: 'a',
          name: 'Some Name D',
          createdAt: 1,
          updatedAt: 1,
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(.*`pk`.*`name`.*`createdAt`.*`updatedAt`.*\) VALUES \(\?, \?, \?, \?\) ON CONFLICT \(`pk`\) DO UPDATE SET .*`name` = EXCLUDED.`name`.*`createdAt` = EXCLUDED.`createdAt`.*`updatedAt` = EXCLUDED.`updatedAt`.*$/,
    );
    expect(values).toEqual(['a', 'Some Name D', 1, 1]);
  }

  shouldUpsertWithDifferentColumnNames() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        Profile,
        { pk: true },
        {
          pk: 1,
          picture: 'image.jpg',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `user_profile` \(.*`pk`.*`image`.*`updatedAt`.*`createdAt`.*\) VALUES \(\?, \?, \?, \?\) ON CONFLICT \(`pk`\) DO UPDATE SET .*`image` = EXCLUDED.`image`.*`updatedAt` = EXCLUDED.`updatedAt`.*$/,
    );
    expect(values).toEqual([1, 'image.jpg', expect.any(Number), expect.any(Number)]);
  }

  shouldUpsertWithNonUpdatableFields() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        User,
        { id: true },
        {
          id: 1,
          email: 'a@b.com',
        },
      ),
    );
    expect(sql).toMatch(
      /^INSERT INTO `User` \(.*`id`.*`email`.*`updatedAt`.*`createdAt`.*\) VALUES \(\?, \?, \?, \?\) ON CONFLICT \(`id`\) DO UPDATE SET .*`updatedAt` = EXCLUDED.`updatedAt`.*$/,
    );
    expect(values).toEqual([1, 'a@b.com', expect.any(Number), expect.any(Number)]);
  }

  override shouldInsertOne() {
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
    expect(res.values[0]).toBe(1640995199999);
    expect(res.values[1]).toBe(123);
  }

  shouldUpsertWithDoNothing() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.upsert(
        ctx,
        ItemTag,
        { id: true },
        {
          id: 1,
        },
      ),
    );
    expect(sql).toBe('INSERT INTO `ItemTag` (`id`) VALUES (?) ON CONFLICT (`id`) DO NOTHING');
    expect(values).toEqual([1]);
  }

  override shouldFind$text() {
    let res = this.exec((ctx) =>
      this.dialect.find(ctx, Item, {
        $select: { id: true },
        $where: { $text: { $fields: ['name', 'description'], $value: 'some text' }, companyId: 1 },
        $limit: 30,
      }),
    );
    expect(res.sql).toBe(
      'SELECT `id` FROM `Item` WHERE `Item` MATCH {`name` `description`} : ? AND `companyId` = ? LIMIT 30',
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
      'SELECT `id` FROM `User` WHERE `User` MATCH {`name`} : ? AND `name` <> ? AND `companyId` = ? LIMIT 10',
    );
    expect(res.values).toEqual(['something', 'other unwanted', 1]);
  }

  override shouldUpdateWithJsonbField() {
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
}

createSpec(new SqliteDialectSpec());
