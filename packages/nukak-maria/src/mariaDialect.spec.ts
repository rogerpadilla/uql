import { createSpec } from 'nukak/test/spec.util.js';
import { AbstractSqlDialectSpec } from 'nukak/dialect/abstractSqlDialect-spec.js';
import { InventoryAdjustment, TaxCategory, User } from 'nukak/test';
import type { FieldKey } from 'nukak/type';
import { MariaDialect } from './mariaDialect.js';

export class MariaDialectSpec extends AbstractSqlDialectSpec {
  constructor() {
    super(new MariaDialect());
  }

  override shouldInsertMany() {
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
      ]),
    ).toBe(
      'INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES' +
        " ('Some name 1', 'someemail1@example.com', 123)" +
        ", ('Some name 2', 'someemail2@example.com', 456)" +
        ", ('Some name 3', 'someemail3@example.com', 789) RETURNING `id` `id`",
    );
  }

  override shouldBeSecure() {
    expect(
      this.dialect.find(User, {
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
    ).toBe('SELECT `id` FROM `User` WHERE `id` = 1 AND `something` = 1 ORDER BY `id`, `something`');

    expect(
      this.dialect.insert(User, {
        name: 'Some Name',
        something: 'anything',
        createdAt: 1,
      } as any),
    ).toBe("INSERT INTO `User` (`name`, `createdAt`) VALUES ('Some Name', 1) RETURNING `id` `id`");

    expect(
      this.dialect.update(
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
    ).toBe("UPDATE `User` SET `name` = 'Some Name', `updatedAt` = 1 WHERE `something` = 'anything'");

    expect(
      this.dialect.delete(User, {
        $where: { something: 'anything' } as any,
      }),
    ).toBe("DELETE FROM `User` WHERE `something` = 'anything'");
  }

  override shouldUpsert() {
    expect(
      this.dialect.upsert(
        User,
        { email: true },
        {
          name: 'Some Name',
          email: 'someemail@example.com',
          createdAt: 123,
        },
      ),
    ).toBe(
      "INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES ('Some Name', 'someemail@example.com', 123) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `createdAt` = VALUES(`createdAt`) RETURNING `id` `id`",
    );
  }

  override shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
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
      ]),
    ).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \('Some Name A', \d+, '.+'\), \('Some Name B', \d+, '50'\), \('Some Name C', \d+, '.+'\), \('Some Name D', \d+, '70'\) RETURNING `pk` `id`$/,
    );
  }

  override shouldInsertOne() {
    expect(
      this.dialect.insert(User, {
        name: 'Some Name',
        email: 'someemail@example.com',
        createdAt: 123,
      }),
    ).toBe(
      "INSERT INTO `User` (`name`, `email`, `createdAt`) VALUES ('Some Name', 'someemail@example.com', 123) RETURNING `id` `id`",
    );

    expect(
      this.dialect.insert(InventoryAdjustment, {
        date: new Date(2021, 11, 31, 23, 59, 59, 999),
        createdAt: 123,
      }),
    ).toBe(
      "INSERT INTO `InventoryAdjustment` (`date`, `createdAt`) VALUES ('2021-12-31 23:59:59.999', 123) RETURNING `id` `id`",
    );
  }

  override shouldInsertWithOnInsertId() {
    expect(
      this.dialect.insert(TaxCategory, {
        name: 'Some Name',
        createdAt: 123,
      }),
    ).toMatch(
      /^INSERT INTO `TaxCategory` \(`name`, `createdAt`, `pk`\) VALUES \('Some Name', 123, '.+'\) RETURNING `pk` `id`$/,
    );
  }
}

createSpec(new MariaDialectSpec());
