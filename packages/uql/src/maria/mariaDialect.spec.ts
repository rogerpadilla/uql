import { AbstractSqlDialectSpec } from '../dialect/abstractSqlDialect-spec.js';
import { InventoryAdjustment, TaxCategory, User } from '../test/index.js';
import { createSpec } from '../test/spec.util.js';
import type { FieldKey } from '../type/index.js';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MariaDialect());
  }

  override shouldInsertMany() {
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
    expect(sql).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
    );
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

  override shouldBeSecure() {
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
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`');
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

  override shouldUpsert() {
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
    expect(sql).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `createdAt` = VALUES(`createdAt`), `updatedAt` = VALUES(`updatedAt`) RETURNING `id` `id`',
    );
    expect(values).toEqual(['Some Name', 'someemail@example.com', 123, expect.any(Number)]);
  }

  override shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
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
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \(\?, \?, \?\), \(\?, \?, \?\), \(\?, \?, \?\), \(\?, \?, \?\) RETURNING `pk` `id`$/,
    );
    expect(values).toEqual([
      'Some Name A',
      expect.any(Number),
      expect.any(String),
      'Some Name B',
      expect.any(Number),
      '50',
      'Some Name C',
      expect.any(Number),
      expect.any(String),
      'Some Name D',
      expect.any(Number),
      '70',
    ]);
  }

  override shouldInsertOne() {
    let res = this.exec((ctx) =>
      this.dialect.insert(ctx, User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES (?, ?, ?) RETURNING `id` `id`');
    expect(res.values).toEqual(['Some Name', 'someemail@example.com', 123]);

    res = this.exec((ctx) =>
      this.dialect.insert(ctx, InventoryAdjustment, {
        date: new Date(2021, 11, 31, 23, 59, 59, 999),
        createdAt: 123,
      }),
    );
    expect(res.sql).toBe('INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`');
    expect(res.values).toEqual([new Date(2021, 11, 31, 23, 59, 59, 999), 123]);
  }

  override shouldInsertWithOnInsertId() {
    const { sql, values } = this.exec((ctx) =>
      this.dialect.insert(ctx, TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    );
    expect(sql).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \(\?, \?, \?\) RETURNING `pk` `id`$/,
    );
    expect(values).toEqual(['Some Name', 123, expect.any(String)]);
  }
}

createSpec(new MariaDialectSpec());
