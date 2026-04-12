import { expect, vi } from 'vitest';
import {
  Company,
  clearTables,
  createTables,
  dropTables,
  InventoryAdjustment,
  Item,
  MeasureUnit,
  type Spec,
  Tag,
  User,
} from '../test/index.js';
import type { QuerierPool } from '../type/index.js';
import { raw } from '../util/index.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

/**
 * Bun's `vi` shim (used by `bun test` on bunSql specs) omits `vi.mocked`, but
 * `vi.spyOn(querier, 'all')` still attaches `mockResolvedValueOnce` on the function.
 */
function mockAllResolvedValueOnce(all: AbstractSqlQuerier['all'], value: unknown): void {
  const spy = all as typeof all & { mockResolvedValueOnce: (v: unknown) => void };
  spy.mockResolvedValueOnce(value);
}

export abstract class AbstractSqlQuerierSpec implements Spec {
  querier!: AbstractSqlQuerier;

  constructor(
    readonly pool: QuerierPool<AbstractSqlQuerier>,
    readonly idType: string,
  ) {}

  async beforeAll() {
    this.querier = await this.pool.getQuerier();
    await dropTables(this.querier);
    await createTables(this.querier, this.idType);
  }

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
    await clearTables(this.querier);
    vi.spyOn(this.querier, 'all');
    vi.spyOn(this.querier, 'run');
  }

  async afterEach() {
    if (this.querier.hasOpenTransaction) {
      await this.querier.rollbackTransaction();
    }
    await this.querier.release();
    vi.restoreAllMocks();
  }

  async afterAll() {
    await this.pool.end();
  }

  async shouldFindOneById() {
    await this.querier.findOneById(User, 1);
    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `name`, `email` FROM `User` WHERE `id` = ? LIMIT 1',
      [1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldFindOne() {
    await this.querier.findOne(User, { $select: { id: true, name: true }, $where: { companyId: 123 } });
    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id`, `name` FROM `User` WHERE `companyId` = ? LIMIT 1',
      [123],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldThrowWhenSelectAndExcludeConflictOnFindOne() {
    await expect(
      this.querier.findOne(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  async shouldThrowWhenSelectAndExcludeConflictOnFindManyAndCount() {
    await expect(
      this.querier.findManyAndCount(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  shouldThrowWhenSelectAndExcludeConflictOnFindManyStream() {
    expect(() =>
      this.querier.findManyStream(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).toThrow('Cannot combine $select and $exclude');
  }

  async shouldThrowWhenNestedSelectAndExcludeConflict() {
    await expect(
      this.querier.findMany(User, {
        $populate: {
          profile: {
            $select: { picture: true },
            $exclude: { createdAt: true },
          },
        },
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  async shouldHydrateJsonFieldFromDriverString() {
    mockAllResolvedValueOnce(this.querier.all, [{ kind: '{"label":"x","isArchived":true}' }]);

    const found = await this.querier.findOne(Company, { $select: { kind: true } });

    expect(found?.kind).toMatchObject({ label: 'x', isArchived: true });
    expect(typeof found?.kind).toBe('object');
  }

  async shouldKeepJsonFieldAsObjectWhenDriverAlreadyParsesIt() {
    mockAllResolvedValueOnce(this.querier.all, [{ kind: { label: 'x', isArchived: false } }]);

    const found = await this.querier.findOne(Company, { $select: { kind: true } });

    expect(found?.kind).toMatchObject({ label: 'x', isArchived: false });
    expect(typeof found?.kind).toBe('object');
  }

  async shouldKeepInvalidJsonStringUntouched() {
    const invalidJson = '{label:"x"';
    mockAllResolvedValueOnce(this.querier.all, [{ kind: invalidJson }]);

    const found = await this.querier.findOne(Company, { $select: { kind: true } });

    expect(found?.kind as unknown).toBe(invalidJson);
  }

  async shouldFindOneAndSelectOneToMany() {
    await this.querier.insertOne(InventoryAdjustment, {
      id: 1,
      description: 'something a',
      createdAt: 1,
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (?, ?, ?)',
      [1, 'something a', 1],
    );

    await this.querier.findOne(InventoryAdjustment, {
      $select: { id: true, description: true },
      $populate: { itemAdjustments: { $where: { id: [5, 6, 7] } } },
      $where: { id: 1 },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id`, `InventoryAdjustment`.`description` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`id` = ? LIMIT 1',
      [1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ', `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `id` IN (?, ?, ?) AND `inventoryAdjustmentId` IN (?)',
      [5, 6, 7, 1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldVirtualField() {
    await this.querier.findMany(Item, {
      $select: { id: 1 },
      $where: {
        tagsCount: { $gte: 10 },
      },
    });

    expect(this.querier.all).toHaveBeenCalledWith(
      'SELECT `id` FROM `Item` WHERE (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `id`) >= ?',
      [10],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
    vi.clearAllMocks();

    await this.querier.findMany(Item, {
      $select: {
        id: 1,
        name: 1,
        code: 1,
        tagsCount: 1,
      },
      $populate: {
        measureUnit: {
          $select: { id: 1, name: 1, categoryId: 1 },
          $populate: { category: { $select: { name: 1 } } },
        },
      },
      $limit: 100,
    });

    expect(this.querier.all).toHaveBeenCalledWith(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) `tagsCount`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100',
      [],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);

    vi.clearAllMocks();

    await this.querier.findMany(Tag, {
      $select: {
        id: 1,
        itemsCount: 1,
      },
    });

    expect(this.querier.all).toHaveBeenCalledWith(
      'SELECT `id`, (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`tagId` = `id`) `itemsCount` FROM `Tag`',
      [],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldFind$exists() {
    await this.querier.findMany(Item, {
      $select: {
        id: 1,
      },
      $where: {
        $exists: raw(({ ctx, dialect, escapedPrefix }: any) => {
          dialect.find(ctx, User, {
            $select: { id: true },
            $where: {
              companyId: raw(({ ctx: innerCtx }: any) => {
                innerCtx.append(escapedPrefix + dialect.escapeId('companyId'));
              }),
            },
          });
        }),
      },
    });

    expect(this.querier.all).toHaveBeenCalledWith(
      'SELECT `id` FROM `Item` WHERE EXISTS (SELECT `id` FROM `User` WHERE `companyId` = `Item`.`companyId`)',
      [],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldFind$nexists() {
    await this.querier.findMany(Item, {
      $select: { id: 1 },
      $where: {
        $nexists: raw(({ ctx, dialect, escapedPrefix }: any) => {
          dialect.find(ctx, User, {
            $select: { id: true },
            $where: {
              companyId: raw(({ ctx: innerCtx }: any) => {
                innerCtx.append(escapedPrefix + dialect.escapeId('companyId'));
              }),
            },
          });
        }),
      },
    });

    expect(this.querier.all).toHaveBeenCalledWith(
      'SELECT `id` FROM `Item` WHERE NOT EXISTS (SELECT `id` FROM `User` WHERE `companyId` = `Item`.`companyId`)',
      [],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldFindOneAndSelectOneToManyOnly() {
    await this.querier.insertMany(InventoryAdjustment, [
      {
        id: 123,
        createdAt: 1,
      },
      { id: 456, createdAt: 1 },
    ]);

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `createdAt`) VALUES (?, ?), (?, ?)',
      [123, 1, 456, 1],
    );

    await this.querier.findMany(InventoryAdjustment, {
      $populate: {
        itemAdjustments: {
          $select: { id: true, buyPrice: true, itemId: true, creatorId: true, createdAt: true },
        },
      },
      $where: { createdAt: 1 },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id`, `InventoryAdjustment`.`companyId`, `InventoryAdjustment`.`creatorId`' +
        ', `InventoryAdjustment`.`createdAt`, `InventoryAdjustment`.`updatedAt`' +
        ', `InventoryAdjustment`.`date`, `InventoryAdjustment`.`description`' +
        ' FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = ?',
      [1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id`, `buyPrice`, `itemId`, `creatorId`, `createdAt`, `inventoryAdjustmentId`' +
        ' FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?, ?)',
      [123, 456],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldFindOneAndSelectOneToManyWithSpecifiedFields() {
    await this.querier.insertMany(InventoryAdjustment, [
      {
        description: 'something a',
        createdAt: 1,
        itemAdjustments: [
          { buyPrice: 1, createdAt: 1 },
          { buyPrice: 1, createdAt: 1 },
        ],
      },
      {
        description: 'something b',
        createdAt: 1,
        itemAdjustments: [
          { id: 1, buyPrice: 1, updatedAt: 1 },
          { buyPrice: 1, createdAt: 1 },
        ],
      },
    ]);

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`description`, `createdAt`) VALUES (?, ?), (?, ?)',
      ['something a', 1, 'something b', 1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (?, ?, ?), (?, ?, ?)',
      [1, 1, 1, 1, 1, 1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (?, ?, ?)',
      [1, 1, 2],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      4,
      'UPDATE `ItemAdjustment` SET `buyPrice` = ?, `updatedAt` = ?, `inventoryAdjustmentId` = ? WHERE `id` = ?',
      [1, 1, 2, 1],
    );

    await this.querier.findMany(InventoryAdjustment, {
      $select: { id: true },
      $populate: { itemAdjustments: { $select: { buyPrice: true }, $skip: 1, $limit: 2 } },
      $where: { createdAt: 1 },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = ?',
      [1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `buyPrice`, `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?, ?) LIMIT 2 OFFSET 1',
      [1, 2],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(4);
  }

  async shouldFindManyAndSelectOneToMany() {
    await this.querier.insertMany(InventoryAdjustment, [
      { id: 123, description: 'something a', createdAt: 1 },
      { id: 456, description: 'something b', createdAt: 1 },
    ]);

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (?, ?, ?), (?, ?, ?)',
      [123, 'something a', 1, 456, 'something b', 1],
    );

    await this.querier.findMany(InventoryAdjustment, {
      $select: { id: true },
      $populate: { itemAdjustments: true },
      $where: { createdAt: 1 },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = ?',
      [1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ', `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?, ?)',
      [123, 456],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldFindOneAndSelectManyToMany() {
    await this.querier.insertOne(Item, { id: 123, createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `Item` (`id`, `createdAt`) VALUES (?, ?)',
      [123, 1],
    );

    await this.querier.findOne(Item, {
      $select: { id: true, createdAt: true },
      $populate: { tags: { $select: { id: true } as any } },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `Item`.`id`, `Item`.`createdAt` FROM `Item` LIMIT 1',
      [],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `ItemTag`.`id`, `ItemTag`.`itemId`, `tag`.`id` `tag.id`' +
        ' FROM `ItemTag` INNER JOIN `Tag` `tag` ON `tag`.`id` = `ItemTag`.`tagId`' +
        ' WHERE `ItemTag`.`itemId` IN (?)',
      [123],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldFindOneByIdAndSelectManyToMany() {
    await this.querier.insertOne(Item, { id: 123, createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `Item` (`id`, `createdAt`) VALUES (?, ?)',
      [123, 1],
    );

    await this.querier.findOneById(Item, 123, {
      $select: { id: 1, createdAt: 1 },
      $populate: { tags: { $select: { id: true } as any } },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `Item`.`id`, `Item`.`createdAt` FROM `Item` WHERE `Item`.`id` = ? LIMIT 1',
      [123],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `ItemTag`.`id`, `ItemTag`.`itemId`, `tag`.`id` `tag.id`' +
        ' FROM `ItemTag` INNER JOIN `Tag` `tag` ON `tag`.`id` = `ItemTag`.`tagId`' +
        ' WHERE `ItemTag`.`itemId` IN (?)',
      [123],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldFindManyAndCount() {
    await this.querier.findManyAndCount(User, {
      $select: { id: true, name: true },
      $where: { companyId: 123 },
      $sort: { createdAt: -1 },
      $skip: 50,
      $limit: 100,
    });
    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id`, `name` FROM `User` WHERE `companyId` = ? ORDER BY `createdAt` DESC LIMIT 100 OFFSET 50',
      [123],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT COUNT(*) `count` FROM `User` WHERE `companyId` = ?',
      [123],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldInsertManyEmpty() {
    const res1 = await this.querier.insertMany(User, []);
    expect(this.querier.run).not.toHaveBeenCalled();
    expect(this.querier.all).not.toHaveBeenCalled();
    expect(res1).toEqual([]);

    const res2 = await this.querier.insertMany(User, undefined as any);
    expect(this.querier.run).not.toHaveBeenCalled();
    expect(this.querier.all).not.toHaveBeenCalled();
    expect(res2).toEqual([]);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { companyId: 123, createdAt: 1 });
    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `User` (`companyId`, `createdAt`) VALUES (?, ?)',
      [123, 1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      createdAt: 1,
      profile: { picture: 'abc', createdAt: 1 },
    });
    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `User` (`name`, `createdAt`) VALUES (?, ?)', [
      'some name',
      1,
    ]);
    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`) VALUES (?, ?, ?)',
      ['abc', 1, 1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldInsertOneAndCascadeManyToOne() {
    await this.querier.insertOne(MeasureUnit, {
      name: 'Centimeter',
      createdAt: 123,
      category: { name: 'Metric', createdAt: 123 },
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `MeasureUnit` (`name`, `createdAt`) VALUES (?, ?)',
      ['Centimeter', 123],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `MeasureUnitCategory` (`name`, `createdAt`) VALUES (?, ?)',
      ['Metric', 123],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(
        /^UPDATE `MeasureUnit` SET `categoryId` = \?, `updatedAt` = \? WHERE `id` = \? AND `deletedAt` IS NULL$/,
      ),
      [1, expect.any(Number), 1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(3);
  }

  async shouldInsertOneAndCascadeOneToMany() {
    await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      createdAt: 1,
      itemAdjustments: [
        { buyPrice: 50, createdAt: 1 },
        { buyPrice: 300, createdAt: 1 },
      ],
    });
    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`description`, `createdAt`) VALUES (?, ?)',
      ['some description', 1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (?, ?, ?), (?, ?, ?)',
      [50, 1, 1, 300, 1, 1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldUpdateMany() {
    await this.querier.updateMany(User, { $where: { companyId: 4 } }, { name: 'Hola', updatedAt: 1 });
    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `companyId` = ?',
      ['Hola', 1, 4],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, 5, { companyId: 123, updatedAt: 1 });
    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'UPDATE `User` SET `companyId` = ?, `updatedAt` = ? WHERE `id` = ?',
      [123, 1, 5],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    await this.querier.insertOne(User, { createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (?)', [1]);

    await this.querier.updateOneById(User, 1, {
      name: 'something',
      updatedAt: 1,
      profile: { picture: 'xyz', createdAt: 1 },
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?',
      ['something', 1, 1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`) VALUES (?, ?, ?)',
      ['xyz', 1, 1],
    );

    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = ?', [1]);

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(3);
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    await this.querier.insertOne(User, { createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (?)', [1]);

    await this.querier.updateOneById(User, 1, {
      name: 'something',
      updatedAt: 1,
      profile: null as any,
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?',
      ['something', 1, 1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = ?', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(2, 'SELECT `pk` FROM `user_profile` WHERE `creatorId` = ?', [1]);

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    await this.querier.insertOne(InventoryAdjustment, { createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`createdAt`) VALUES (?)',
      [1],
    );

    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      updatedAt: 1,
      itemAdjustments: [
        { buyPrice: 50, createdAt: 1 },
        { buyPrice: 300, createdAt: 1 },
      ],
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `InventoryAdjustment` SET `description` = ?, `updatedAt` = ? WHERE `id` = ?',
      ['some description', 1, 1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = ?', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = ?',
      [1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (?, ?, ?), (?, ?, ?)',
      [50, 1, 1, 300, 1, 1],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(3);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`createdAt`) VALUES (?)',
      [1],
    );

    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      updatedAt: 1,
      itemAdjustments: null as any,
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `InventoryAdjustment` SET `description` = ?, `updatedAt` = ? WHERE `id` = ?',
      ['some description', 1, 1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = ?', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = ?',
      [1],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { companyId: 1, createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`companyId`, `createdAt`) VALUES (?, ?)',
      [1, 1],
    );

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: { companyId: 1 } },
      {
        description: 'some description',
        updatedAt: 1,
        itemAdjustments: null as any,
      },
    );

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `InventoryAdjustment` SET `description` = ?, `updatedAt` = ? WHERE `companyId` = ?',
      ['some description', 1, 1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id` FROM `InventoryAdjustment` WHERE `companyId` = ?',
      [1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = ?',
      [1],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldInsertOneAndCascadeManyToManyInserts() {
    await this.querier.insertOne(Item, {
      name: 'item one',
      createdAt: 1,
      tags: [
        {
          name: 'tag one',
          createdAt: 1,
        },
        {
          name: 'tag two',
          createdAt: 1,
        },
      ],
    });
    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `Item` (`name`, `createdAt`) VALUES (?, ?)', [
      'item one',
      1,
    ]);
    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `Tag` (`name`, `createdAt`) VALUES (?, ?), (?, ?)',
      ['tag one', 1, 'tag two', 1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (?, ?), (?, ?)',
      [1, 1, 1, 2],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(3);
  }

  async shouldUpdateAndCascadeManyToManyInserts() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `Item` (`createdAt`) VALUES (?)', [1]);

    await this.querier.updateOneById(Item, id, {
      name: 'item one',
      updatedAt: 1,
      tags: [
        {
          name: 'tag one',
          createdAt: 1,
        },
        {
          name: 'tag two',
          createdAt: 1,
        },
      ],
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `Item` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?',
      ['item one', 1, 1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = ?', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `Tag` (`name`, `createdAt`) VALUES (?, ?), (?, ?)',
      ['tag one', 1, 'tag two', 1],
    );

    expect(this.querier.all).toHaveBeenNthCalledWith(2, 'SELECT `id` FROM `ItemTag` WHERE `itemId` = ?', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(
      4,
      'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (?, ?), (?, ?)',
      [1, 1, 1, 2],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(4);
  }

  async shouldUpdateAndCascadeManyToManyLinks() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });

    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `Item` (`createdAt`) VALUES (?)', [1]);

    await this.querier.updateOneById(Item, id, {
      name: 'item one',
      tags: [{ id: 22 }, { id: 33 }],
      updatedAt: 1,
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE `Item` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?',
      ['item one', 1, 1],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = ?', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(2, 'SELECT `id` FROM `ItemTag` WHERE `itemId` = ?', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (?, ?), (?, ?)',
      [1, 22, 1, 33],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(3);
  }

  async shouldDeleteOneAndCascadeManyToManyDeletes() {
    await this.shouldInsertOneAndCascadeManyToManyInserts();

    vi.clearAllMocks();

    await this.querier.deleteOneById(Item, 1);

    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = ?', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(2, 'SELECT `id` FROM `ItemTag` WHERE `itemId` IN (?)', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'DELETE FROM `Item` WHERE `id` IN (?)', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(2, 'DELETE FROM `ItemTag` WHERE `id` IN (?, ?)', [1, 2]);

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldDeleteOneAndNoCascadeManyToManyDeletes() {
    await this.shouldInsertOneAndCascadeManyToManyInserts();

    vi.clearAllMocks();

    await this.querier.deleteOneById(Tag, 1);

    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `Tag` WHERE `id` = ?', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'DELETE FROM `Tag` WHERE `id` IN (?)', [1]);

    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldDeleteOneById() {
    const id = await this.querier.insertOne(User, { createdAt: 1, profile: { createdAt: 1 } });

    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (?)', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `user_profile` (`createdAt`, `creatorId`) VALUES (?, ?)',
      [1, 1],
    );

    await this.querier.deleteOneById(User, id);

    expect(this.querier.run).toHaveBeenNthCalledWith(3, 'DELETE FROM `User` WHERE `id` IN (?)', [1]);
    expect(this.querier.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `user_profile` WHERE `pk` IN (?)', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = ?', [1]);
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `pk` FROM `user_profile` WHERE `creatorId` IN (?)',
      [1],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(4);
  }

  async shouldDeleteMany() {
    await this.querier.insertOne(User, { createdAt: 123 });

    expect(this.querier.run).toHaveBeenNthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (?)', [123]);

    await this.querier.deleteMany(User, { $where: { createdAt: 123 } });

    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `createdAt` = ?', [123]);
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `pk` FROM `user_profile` WHERE `creatorId` IN (?)',
      [1],
    );
    expect(this.querier.run).toHaveBeenNthCalledWith(2, 'DELETE FROM `User` WHERE `id` IN (?)', [1]);

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(2);
  }

  async shouldCount() {
    await this.querier.count(User, { $where: { companyId: 123 } });
    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) `count` FROM `User` WHERE `companyId` = ?',
      [123],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldUseTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.updateOneById(User, 5, { name: 'Hola', updatedAt: 1 });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.commitTransaction();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.run).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledWith('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?', [
      'Hola',
      1,
      5,
    ]);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
  }

  async shouldUseTransactionCallback() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.transaction(async () => {
      expect(this.querier.hasOpenTransaction).toBe(true);
      await this.querier.updateOneById(User, 5, { name: 'Hola', updatedAt: 1 });
    });
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.run).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledWith('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?', [
      'Hola',
      1,
      5,
    ]);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
  }

  async shouldBeginTransactionWithIsolationLevel() {
    const internalRunSpy = vi.spyOn(this.querier as any, 'internalRun');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction({ isolationLevel: 'serializable' });
    expect(this.querier.hasOpenTransaction).toBe(true);

    // Verify the correct SQL was forwarded to internalRun
    const expectedStatements = this.querier.dialect.getBeginTransactionStatements('serializable');
    for (let i = 0; i < expectedStatements.length; i++) {
      expect(internalRunSpy).toHaveBeenNthCalledWith(i + 1, expectedStatements[i]);
    }
    expect(internalRunSpy).toHaveBeenCalledTimes(expectedStatements.length);

    await this.querier.commitTransaction();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
  }

  async shouldUseTransactionCallbackWithIsolationLevel() {
    const internalRunSpy = vi.spyOn(this.querier as any, 'internalRun');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.transaction(
      async () => {
        expect(this.querier.hasOpenTransaction).toBe(true);
        await this.querier.updateOneById(User, 5, { name: 'Hola', updatedAt: 1 });
      },
      { isolationLevel: 'read committed' },
    );
    expect(this.querier.hasOpenTransaction).toBeFalsy();

    // First call(s) should be the isolation-level SQL, then the UPDATE via run
    const expectedStatements = this.querier.dialect.getBeginTransactionStatements('read committed');
    for (let i = 0; i < expectedStatements.length; i++) {
      expect(internalRunSpy).toHaveBeenNthCalledWith(i + 1, expectedStatements[i]);
    }
    expect(this.querier.run).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledWith('UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?', [
      'Hola',
      1,
      5,
    ]);
  }

  async shouldBeginTransactionWithoutIsolationLevel() {
    const internalRunSpy = vi.spyOn(this.querier as any, 'internalRun');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);

    // Without isolation level, only the base command is emitted
    expect(internalRunSpy).toHaveBeenCalledTimes(1);
    expect(internalRunSpy).toHaveBeenCalledWith(this.querier.dialect.beginTransactionCommand);

    await this.querier.commitTransaction();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
  }

  async shouldThrowIfRollbackIfErrorInCallback() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    const prom = this.querier.transaction(async () => {
      expect(this.querier.hasOpenTransaction).toBe(true);
      throw new Error('some error');
    });
    await expect(prom).rejects.toThrow('some error');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.run).toHaveBeenCalledTimes(0);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
  }

  async shouldThrowIfTransactionIsPending() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
  }

  async shouldReuseTransactionWhenNested() {
    const internalRunSpy = vi.spyOn(this.querier as any, 'internalRun');
    expect(this.querier.hasOpenTransaction).toBeFalsy();

    await this.querier.transaction(async () => {
      expect(this.querier.hasOpenTransaction).toBe(true);

      // Nested transaction should reuse — no additional beginTransaction
      const innerResult = await this.querier.transaction(async () => {
        expect(this.querier.hasOpenTransaction).toBe(true);
        await this.querier.updateOneById(User, 5, { name: 'nested' });
        return 42;
      });

      expect(innerResult).toBe(42);
      expect(this.querier.hasOpenTransaction).toBe(true);
    });

    expect(this.querier.hasOpenTransaction).toBeFalsy();

    // beginTransaction called once (outer only), commitTransaction once
    const beginStatements = this.querier.dialect.getBeginTransactionStatements();
    expect(internalRunSpy).toHaveBeenNthCalledWith(1, beginStatements[0]);
    // The UPDATE runs via run()
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldRollbackEntireTransactionWhenNestedThrows() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();

    const prom = this.querier.transaction(async () => {
      expect(this.querier.hasOpenTransaction).toBe(true);

      await this.querier.transaction(async () => {
        throw new Error('inner error');
      });
    });

    await expect(prom).rejects.toThrow('inner error');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
  }

  async shouldIgnoreIsolationLevelWhenReusing() {
    const internalRunSpy = vi.spyOn(this.querier as any, 'internalRun');
    expect(this.querier.hasOpenTransaction).toBeFalsy();

    await this.querier.transaction(
      async () => {
        // Inner call specifies a different isolation level — should be ignored
        await this.querier.transaction(
          async () => {
            await this.querier.updateOneById(User, 5, { name: 'nested' });
          },
          { isolationLevel: 'read uncommitted' },
        );
      },
      { isolationLevel: 'serializable' },
    );

    expect(this.querier.hasOpenTransaction).toBeFalsy();

    // Only the outer isolation level SQL should have been emitted
    const outerStatements = this.querier.dialect.getBeginTransactionStatements('serializable');
    for (let i = 0; i < outerStatements.length; i++) {
      expect(internalRunSpy).toHaveBeenNthCalledWith(i + 1, outerStatements[i]);
    }

    // No 'read uncommitted' statements should appear
    const innerStatements = this.querier.dialect.getBeginTransactionStatements('read uncommitted');
    for (const stmt of innerStatements) {
      if (stmt !== outerStatements[0]) {
        expect(internalRunSpy).not.toHaveBeenCalledWith(stmt);
      }
    }
  }

  async shouldReuseDeeplyNestedTransactions() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();

    const result = await this.querier.transaction(async () => {
      expect(this.querier.hasOpenTransaction).toBe(true);

      return this.querier.transaction(async () => {
        expect(this.querier.hasOpenTransaction).toBe(true);

        return this.querier.transaction(async () => {
          expect(this.querier.hasOpenTransaction).toBe(true);
          await this.querier.updateOneById(User, 5, { name: 'deep' });
          return 'deep-value';
        });
      });
    });

    expect(result).toBe('deep-value');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }

  async shouldThrowIfCommitWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.run).toHaveBeenCalledTimes(0);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
  }

  async shouldThrowIfRollbackWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.run).toHaveBeenCalledTimes(0);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
  }

  async shouldThrowIfReleaseWithPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.updateOneById(User, 5, { name: 'some name' });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    await this.querier.rollbackTransaction();
    await this.querier.release();
  }

  async shouldBeIdempotentRelease() {
    await this.querier.release();
    await expect(this.querier.release()).resolves.toBeUndefined();
  }

  async shouldReleaseIfFreeWithoutTransaction() {
    // Release should work when no transaction is open
    await (this.querier as any).releaseIfFree();
    // Should not throw, just release
    expect(this.querier.all).toHaveBeenCalledTimes(0);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldNotReleaseIfFreeWithOpenTransaction() {
    // Begin a transaction
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);

    // releaseIfFree should NOT release when transaction is open
    await this.querier.releaseIfFree();

    // Transaction should still be open
    expect(this.querier.hasOpenTransaction).toBe(true);

    // Clean up - rollback the transaction
    await this.querier.rollbackTransaction();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
  }

  async shouldFindOneAndSelectOneToManyWithObjectSelect() {
    await this.querier.insertOne(InventoryAdjustment, {
      id: 999,
      description: 'test adjustment',
      createdAt: 1,
    });

    expect(this.querier.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (?, ?, ?)',
      [999, 'test adjustment', 1],
    );

    // Use object-style $select for the relation (not array)
    await this.querier.findMany(InventoryAdjustment, {
      $select: {
        id: true,
      },
      $populate: {
        itemAdjustments: { $select: { buyPrice: true, itemId: true } },
      },
      $where: { id: 999 },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`id` = ?',
      [999],
    );
    expect(this.querier.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `buyPrice`, `itemId`, `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?)',
      [999],
    );

    expect(this.querier.all).toHaveBeenCalledTimes(2);
    expect(this.querier.run).toHaveBeenCalledTimes(1);
  }
  async shouldAggregate() {
    await this.querier.aggregate(User, {
      $group: { total: { $count: '*' } },
    });
    expect(this.querier.all).toHaveBeenNthCalledWith(1, 'SELECT COUNT(*) `total` FROM `User`', []);
    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldAggregateWithGroupAndHaving() {
    await this.querier.insertMany(User, [
      { companyId: 1, createdAt: 1 },
      { companyId: 1, createdAt: 2 },
      { companyId: 2, createdAt: 3 },
    ]);

    vi.clearAllMocks();

    await this.querier.aggregate(User, {
      $group: { companyId: true, cnt: { $count: '*' } },
      $having: { cnt: { $gt: 1 } },
      $sort: { cnt: -1 },
    });

    expect(this.querier.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `companyId`, COUNT(*) `cnt` FROM `User` GROUP BY `companyId` HAVING COUNT(*) > ? ORDER BY COUNT(*) DESC',
      [1],
    );
    expect(this.querier.all).toHaveBeenCalledTimes(1);
    expect(this.querier.run).toHaveBeenCalledTimes(0);
  }

  async shouldDistinct() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice1@test.com', createdAt: 1 },
      { name: 'Alice', email: 'alice2@test.com', createdAt: 1 },
      { name: 'Bob', email: 'bob@test.com', createdAt: 1 },
    ]);

    (this.querier.all as any).mockClear();
    (this.querier.run as any).mockClear();

    const distinctRows = await this.querier.findMany(User, {
      $select: { name: true },
      $distinct: true,
    });

    expect(this.querier.all).toHaveBeenCalledWith('SELECT DISTINCT `name` FROM `User`', []);
    expect(distinctRows).toHaveLength(2);
    expect(distinctRows.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
  }

  async shouldFindManyStream() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com', createdAt: 1 },
      { name: 'Bob', email: 'bob@test.com', createdAt: 1 },
    ]);

    (this.querier.all as any).mockClear();
    (this.querier.run as any).mockClear();

    const collected: User[] = [];
    for await (const row of this.querier.findManyStream(User, {
      $select: { name: true },
    })) {
      collected.push(row);
    }

    expect(collected).toHaveLength(2);
    expect(collected.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
  }

  async shouldThrowWhenStreamRequestsToManyRelation() {
    await expect(
      (async () => {
        for await (const _ of this.querier.findManyStream(User, { $populate: { users: true } })) {
        }
      })(),
    ).rejects.toThrow('findManyStream does not load to-many relations');
  }
}
