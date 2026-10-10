import { expect, type Mock, vi } from 'vitest';
import type { AbstractSqlDialect } from '../dialect/index.js';
import {
  anyUuid,
  Company,
  clearTables,
  recreateTables,
  InventoryAdjustment,
  Item,
  MeasureUnit,
  type Spec,
  Tag,
  User,
  VersionedNote,
} from '../test/index.js';
import type { QuerierPool, QuerySearch, QueryUpdateResult } from '../type/index.js';
import { sql } from '../util/index.js';
import type { AbstractSqlQuerier } from './abstractSqlQuerier.js';

export abstract class AbstractSqlQuerierSpec implements Spec {
  querier!: AbstractSqlQuerier;
  all!: Mock<(sql: string, values?: unknown[]) => Promise<unknown[]>>;
  run!: Mock<(sql: string, values?: unknown[]) => Promise<QueryUpdateResult>>;

  constructor(readonly pool: QuerierPool<AbstractSqlQuerier, AbstractSqlDialect>) {}

  beforeAll() {
    return recreateTables(this.pool);
  }

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
    await clearTables(this.querier);
    this.all = vi.spyOn(this.querier, 'internalAll');
    this.run = vi.spyOn(this.querier, 'internalRun');
  }

  async afterEach() {
    await this.querier.rollbackTransaction();
    await this.querier.release();
    vi.restoreAllMocks();
  }

  async afterAll() {
    await this.pool.end();
  }

  async shouldFindOneById() {
    await this.querier.findOneById(User, '1');
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `name`, `email` FROM `User` WHERE `id` = ? LIMIT 1',
      ['1'],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldFindOne() {
    await this.querier.findOne(User, { $select: { id: true, name: true }, $where: { companyId: '123' } });
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id`, `name` FROM `User` WHERE `companyId` = ? LIMIT 1', [
      '123',
    ]);
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldRefuseASelectAndExcludeConflictOnFindOne() {
    await expect(
      this.querier.findOne(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  /** Checked as written, before the page reads a sort key the projection left out and spells `$select` whole. */
  async shouldRefuseASelectAndExcludeConflictOnFindManyPage() {
    await expect(
      this.querier.findManyPage(User, {
        $select: { name: true },
        $exclude: { email: true },
        $sort: { createdAt: -1, id: 1 },
        $limit: 2,
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  async shouldRefuseASelectAndExcludeConflictOnFindManyAndCount() {
    await expect(
      this.querier.findManyAndCount(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  shouldRefuseASelectAndExcludeConflictOnFindManyStream() {
    expect(() =>
      this.querier.findManyStream(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).toThrow('Cannot combine $select and $exclude');
  }

  async shouldRefuseANestedSelectAndExcludeConflict() {
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
    this.all.mockResolvedValueOnce([{ kind: '{"label":"x","isArchived":true}' }]);

    const found = await this.querier.findOne(Company, { $select: { kind: true } });

    expect(found?.kind).toMatchObject({ label: 'x', isArchived: true });
    expect(typeof found?.kind).toBe('object');
  }

  async shouldKeepJsonFieldAsObjectWhenDriverAlreadyParsesIt() {
    this.all.mockResolvedValueOnce([{ kind: { label: 'x', isArchived: false } }]);

    const found = await this.querier.findOne(Company, { $select: { kind: true } });

    expect(found?.kind).toMatchObject({ label: 'x', isArchived: false });
    expect(typeof found?.kind).toBe('object');
  }

  async shouldKeepInvalidJsonStringUntouched() {
    const invalidJson = '{label:"x"';
    this.all.mockResolvedValueOnce([{ kind: invalidJson }]);

    const found = await this.querier.findOne(Company, { $select: { kind: true } });

    expect(found?.kind).toBe(invalidJson);
  }

  async shouldFindOneAndSelectOneToMany() {
    await this.querier.insertOne(InventoryAdjustment, {
      id: '1',
      description: 'something a',
      createdAt: 1,
    });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['1', 'something a', 1],
    );

    await this.querier.findOne(InventoryAdjustment, {
      $select: { id: true, description: true },
      $populate: { itemAdjustments: { $where: { id: ['5', '6', '7'] } } },
      $where: { id: '1' },
    });

    // One statement: the children are a correlated subquery of the parent's own, aggregated as JSON.
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id`, `InventoryAdjustment`.`description`' +
        ", (SELECT json_group_array(json_object('id', `itemAdjustments`.`id`, 'companyId', `itemAdjustments`.`companyId`, 'creatorId', `itemAdjustments`.`creatorId`, 'createdAt', `itemAdjustments`.`createdAt`, 'updatedAt', `itemAdjustments`.`updatedAt`, 'itemId', `itemAdjustments`.`itemId`, 'number', `itemAdjustments`.`number`, 'buyPrice', `itemAdjustments`.`buyPrice`, 'storehouseId', `itemAdjustments`.`storehouseId`, 'inventoryAdjustmentId', `itemAdjustments`.`inventoryAdjustmentId`))" +
        ' FROM (SELECT `itemAdjustments`.`id`, `itemAdjustments`.`companyId`, `itemAdjustments`.`creatorId`, CAST(`itemAdjustments`.`createdAt` AS TEXT) `createdAt`, CAST(`itemAdjustments`.`updatedAt` AS TEXT) `updatedAt`, `itemAdjustments`.`itemId`, CAST(`itemAdjustments`.`number` AS TEXT) `number`, CAST(`itemAdjustments`.`buyPrice` AS TEXT) `buyPrice`, `itemAdjustments`.`storehouseId`, `itemAdjustments`.`inventoryAdjustmentId` FROM `ItemAdjustment` `itemAdjustments`' +
        ' WHERE `itemAdjustments`.`id` IN (?, ?, ?) AND `itemAdjustments`.`inventoryAdjustmentId` = `InventoryAdjustment`.`id`) `itemAdjustments`) `itemAdjustments`' +
        ' FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`id` = ? LIMIT 1',
      ['5', '6', '7', '1'],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  async shouldComputedField() {
    await this.querier.findMany(Item, {
      $select: { id: 1 },
      $where: {
        tagsCount: { $gte: 10 },
      },
    });

    expect(this.all).toHaveBeenCalledWith(
      'SELECT `id` FROM `Item` WHERE (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) >= ?',
      [10],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
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

    expect(this.all).toHaveBeenCalledWith(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) `tagsCount`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId` AND `measureUnit`.`deletedAt` IS NULL' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId` AND `measureUnit.category`.`deletedAt` IS NULL' +
        ' LIMIT 100',
      [],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);

    vi.clearAllMocks();

    await this.querier.findMany(Tag, {
      $select: {
        id: 1,
        itemsCount: 1,
      },
    });

    expect(this.all).toHaveBeenCalledWith(
      'SELECT `id`, (SELECT COUNT(*) FROM `ItemTag` WHERE `ItemTag`.`tagId` = `Tag`.`id`) `itemsCount` FROM `Tag`',
      [],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldFind$exists() {
    await this.querier.findMany(Item, {
      $select: {
        id: 1,
      },
      $where: {
        $exists: sql((rawOpts) => {
          const { ctx, dialect, escapedPrefix } = rawOpts;
          dialect.find(ctx, User, {
            $select: { id: true },
            $where: {
              companyId: sql((innerOpts) => {
                const { ctx: innerCtx } = innerOpts;
                innerCtx.append(escapedPrefix + dialect.escapeId('companyId'));
              }),
            },
          });
        }),
      },
    });

    expect(this.all).toHaveBeenCalledWith(
      'SELECT `id` FROM `Item` WHERE EXISTS (SELECT `id` FROM `User` WHERE `companyId` = `Item`.`companyId`)',
      [],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldFind$nexists() {
    await this.querier.findMany(Item, {
      $select: { id: 1 },
      $where: {
        $nexists: sql((rawOpts) => {
          const { ctx, dialect, escapedPrefix } = rawOpts;
          dialect.find(ctx, User, {
            $select: { id: true },
            $where: {
              companyId: sql((innerOpts) => {
                const { ctx: innerCtx } = innerOpts;
                innerCtx.append(escapedPrefix + dialect.escapeId('companyId'));
              }),
            },
          });
        }),
      },
    });

    expect(this.all).toHaveBeenCalledWith(
      'SELECT `id` FROM `Item` WHERE NOT EXISTS (SELECT `id` FROM `User` WHERE `companyId` = `Item`.`companyId`)',
      [],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldFindOneAndSelectOneToManyOnly() {
    await this.querier.insertMany(InventoryAdjustment, [
      {
        id: '123',
        createdAt: 1,
      },
      { id: '456', createdAt: 1 },
    ]);

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `createdAt`) VALUES (?, ?), (?, ?) RETURNING `id` `id`',
      ['123', 1, '456', 1],
    );

    await this.querier.findMany(InventoryAdjustment, {
      $populate: {
        itemAdjustments: {
          $select: { id: true, buyPrice: true, itemId: true, creatorId: true, createdAt: true },
        },
      },
      $where: { createdAt: 1 },
    });

    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id`, `InventoryAdjustment`.`companyId`, `InventoryAdjustment`.`creatorId`' +
        ', `InventoryAdjustment`.`createdAt`, `InventoryAdjustment`.`updatedAt`' +
        ', `InventoryAdjustment`.`date`, `InventoryAdjustment`.`description`' +
        ", (SELECT json_group_array(json_object('id', `itemAdjustments`.`id`, 'buyPrice', `itemAdjustments`.`buyPrice`" +
        ", 'itemId', `itemAdjustments`.`itemId`, 'creatorId', `itemAdjustments`.`creatorId`, 'createdAt', `itemAdjustments`.`createdAt`))" +
        ' FROM (SELECT `itemAdjustments`.`id`, CAST(`itemAdjustments`.`buyPrice` AS TEXT) `buyPrice`, `itemAdjustments`.`itemId`' +
        ', `itemAdjustments`.`creatorId`, CAST(`itemAdjustments`.`createdAt` AS TEXT) `createdAt` FROM `ItemAdjustment` `itemAdjustments`' +
        ' WHERE `itemAdjustments`.`inventoryAdjustmentId` = `InventoryAdjustment`.`id`) `itemAdjustments`) `itemAdjustments`' +
        ' FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = ?',
      [1],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(1);
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
          { id: '1', buyPrice: 1, updatedAt: 1 },
          { buyPrice: 1, createdAt: 1 },
        ],
      },
    ]);

    expect(this.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `InventoryAdjustment` (`description`, `createdAt`, `id`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      ['something a', 1, anyUuid, 'something b', 1, anyUuid],
    );
    // Every parent's new children in one statement, not one per parent.
    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`, `id`) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?) RETURNING `id` `id`',
      [1, 1, anyUuid, anyUuid, 1, 1, anyUuid, anyUuid, 1, 1, anyUuid, anyUuid],
    );
    // The child names its key, so `save` upserts on it rather than issuing a bare `UPDATE` that reports
    // success on a missing row. `createdAt` rides the insert arm only, so an existing row keeps its own.
    expect(this.run).toHaveBeenNthCalledWith(
      4,
      'INSERT INTO `ItemAdjustment` (`id`, `buyPrice`, `updatedAt`, `inventoryAdjustmentId`, `createdAt`) VALUES (?, ?, ?, ?, ?) ON CONFLICT (`id`) DO UPDATE SET `buyPrice` = EXCLUDED.`buyPrice`, `updatedAt` = EXCLUDED.`updatedAt`, `inventoryAdjustmentId` = EXCLUDED.`inventoryAdjustmentId` RETURNING `id` `id`',
      ['1', 1, 1, anyUuid, expect.any(Number)],
    );

    await this.querier.findMany(InventoryAdjustment, {
      $select: { id: true },
      $populate: { itemAdjustments: { $select: { buyPrice: true }, $skip: 1, $limit: 2 } },
      $where: { createdAt: 1 },
    });

    // Per parent, not one page across all of them: each parent's rows are paged inside its own
    // correlated subquery, which is what `$limit` inside a to-many means.
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      "SELECT `InventoryAdjustment`.`id`, (SELECT json_group_array(json_object('buyPrice', `itemAdjustments`.`buyPrice`))" +
        ' FROM (SELECT CAST(`itemAdjustments`.`buyPrice` AS TEXT) `buyPrice` FROM `ItemAdjustment` `itemAdjustments`' +
        ' WHERE `itemAdjustments`.`inventoryAdjustmentId` = `InventoryAdjustment`.`id` LIMIT 2 OFFSET 1) `itemAdjustments`) `itemAdjustments`' +
        ' FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = ?',
      [1],
    );

    expect(this.run).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(5);
  }

  async shouldFindManyAndSelectOneToMany() {
    await this.querier.insertMany(InventoryAdjustment, [
      { id: '123', description: 'something a', createdAt: 1 },
      { id: '456', description: 'something b', createdAt: 1 },
    ]);

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      ['123', 'something a', 1, '456', 'something b', 1],
    );

    await this.querier.findMany(InventoryAdjustment, {
      $select: { id: true },
      $populate: { itemAdjustments: true },
      $where: { createdAt: 1 },
    });

    expect(this.all).toHaveBeenNthCalledWith(
      1,
      "SELECT `InventoryAdjustment`.`id`, (SELECT json_group_array(json_object('id', `itemAdjustments`.`id`, 'companyId', `itemAdjustments`.`companyId`, 'creatorId', `itemAdjustments`.`creatorId`, 'createdAt', `itemAdjustments`.`createdAt`, 'updatedAt', `itemAdjustments`.`updatedAt`, 'itemId', `itemAdjustments`.`itemId`, 'number', `itemAdjustments`.`number`, 'buyPrice', `itemAdjustments`.`buyPrice`, 'storehouseId', `itemAdjustments`.`storehouseId`, 'inventoryAdjustmentId', `itemAdjustments`.`inventoryAdjustmentId`))" +
        ' FROM (SELECT `itemAdjustments`.`id`, `itemAdjustments`.`companyId`, `itemAdjustments`.`creatorId`, CAST(`itemAdjustments`.`createdAt` AS TEXT) `createdAt`, CAST(`itemAdjustments`.`updatedAt` AS TEXT) `updatedAt`, `itemAdjustments`.`itemId`, CAST(`itemAdjustments`.`number` AS TEXT) `number`, CAST(`itemAdjustments`.`buyPrice` AS TEXT) `buyPrice`, `itemAdjustments`.`storehouseId`, `itemAdjustments`.`inventoryAdjustmentId` FROM `ItemAdjustment` `itemAdjustments`' +
        ' WHERE `itemAdjustments`.`inventoryAdjustmentId` = `InventoryAdjustment`.`id`) `itemAdjustments`) `itemAdjustments`' +
        ' FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = ?',
      [1],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  async shouldFindOneAndSelectManyToMany() {
    await this.querier.insertOne(Item, { id: '123', createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `Item` (`id`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`',
      ['123', 1],
    );

    await this.querier.findOne(Item, {
      $select: { id: true, createdAt: true },
      $populate: { tags: { $select: { id: true } } },
    });

    // Each target once, through the junction rows pairing it to the parent.
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `Item`.`id`, `Item`.`createdAt`' +
        ", (SELECT json_group_array(json_object('id', `tags`.`id`)) FROM (SELECT `tags`.`id` FROM `Tag` `tags`" +
        ' WHERE `tags`.`id` IN (SELECT `ItemTag`.`tagId` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`)) `tags`) `tags`' +
        ' FROM `Item` LIMIT 1',
      [],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  async shouldFindOneByIdAndSelectManyToMany() {
    await this.querier.insertOne(Item, { id: '123', createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `Item` (`id`, `createdAt`) VALUES (?, ?) RETURNING `id` `id`',
      ['123', 1],
    );

    await this.querier.findOneById(Item, '123', {
      $select: { id: 1, createdAt: 1 },
      $populate: { tags: { $select: { id: true } } },
    });

    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `Item`.`id`, `Item`.`createdAt`' +
        ", (SELECT json_group_array(json_object('id', `tags`.`id`)) FROM (SELECT `tags`.`id` FROM `Tag` `tags`" +
        ' WHERE `tags`.`id` IN (SELECT `ItemTag`.`tagId` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`)) `tags`) `tags`' +
        ' FROM `Item` WHERE `Item`.`id` = ? LIMIT 1',
      ['123'],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  /** One statement, not two: the page carries its own unpaged total in an extra column. */
  async shouldFindManyAndCount() {
    this.all.mockResolvedValueOnce([{ id: 1, name: 'a', _uql_total: 7 }]);

    const [founds, count] = await this.querier.findManyAndCount(User, {
      $select: { id: true, name: true },
      $where: { companyId: '123' },
      $sort: { createdAt: -1 },
      $skip: 50,
      $limit: 100,
    });
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id`, `name`, COUNT(*) OVER () `_uql_total` FROM `User` WHERE `companyId` = ?' +
        ' ORDER BY `createdAt` DESC LIMIT 100 OFFSET 50',
      ['123'],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
    expect(count).toBe(7);
    expect(founds).toEqual([{ id: 1, name: 'a' }]);
  }

  /**
   * A `$distinct` read counts its deduplicated set through a derived table, because `COUNT(*)` counts
   * before the deduplication and a window function does too. Two statements, and the inner one takes
   * the projection and the filter but never the page - the total is what lies beyond it.
   */
  async shouldFindManyAndCountDistinctThroughADerivedTable() {
    this.all.mockResolvedValueOnce([{ name: 'a' }]);
    this.all.mockResolvedValueOnce([{ _uql_value: 2 }]);

    const [, total] = await this.querier.findManyAndCount(User, {
      $select: { name: true },
      $where: { companyId: '123' },
      $distinct: true,
      $limit: 1,
    });

    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT DISTINCT `name` FROM `User` WHERE `companyId` = ? LIMIT 1', [
      '123',
    ]);
    expect(this.all).toHaveBeenNthCalledWith(
      2,
      'SELECT COUNT(*) `_uql_value` FROM (SELECT DISTINCT `name` FROM `User` WHERE `companyId` = ?) `_uql_rows`',
      ['123'],
    );
    expect(this.all).toHaveBeenCalledTimes(2);
    expect(total).toBe(2);
  }

  /** An empty page carries no row to read the total off, so that one case falls back to a count. */
  async shouldFindManyAndCountFallingBackOnAnEmptyPage() {
    this.all.mockResolvedValueOnce([]);
    this.all.mockResolvedValueOnce([{ _uql_value: 7 }]);

    const [founds, count] = await this.querier.findManyAndCount(User, { $where: { companyId: '123' }, $skip: 50 });
    expect(this.all).toHaveBeenNthCalledWith(2, 'SELECT COUNT(*) `_uql_value` FROM `User` WHERE `companyId` = ?', [
      '123',
    ]);
    expect(this.all).toHaveBeenCalledTimes(2);
    expect(founds).toEqual([]);
    expect(count).toBe(7);
  }

  async shouldInsertManyEmpty() {
    const res1 = await this.querier.insertMany(User, []);
    expect(this.run).not.toHaveBeenCalled();
    expect(this.all).not.toHaveBeenCalled();
    expect(res1).toEqual([]);
  }

  async shouldInsertOne() {
    await this.pool.insertOne(Company, { id: '123' });
    await this.querier.insertOne(User, { companyId: '123', createdAt: 1 });
    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `User` (`companyId`, `createdAt`, `id`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['123', 1, anyUuid],
    );
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      createdAt: 1,
      profile: { picture: 'abc', createdAt: 1 },
    });
    expect(this.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `User` (`name`, `createdAt`, `id`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['some name', 1, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`, `pk`) VALUES (?, ?, ?, ?) RETURNING `pk` `id`',
      ['abc', 1, anyUuid, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(4);
  }

  async shouldInsertOneAndCascadeManyToOne() {
    await this.querier.insertOne(MeasureUnit, {
      name: 'Centimeter',
      createdAt: 123,
      category: { name: 'Metric', createdAt: 123 },
    });

    // The target first, so the row inserts already holding its key: a NOT NULL one is never left empty.
    expect(this.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `MeasureUnitCategory` (`name`, `createdAt`, `id`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['Metric', 123, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `MeasureUnit` (`name`, `createdAt`, `categoryId`, `id`) VALUES (?, ?, ?, ?) RETURNING `id` `id`',
      ['Centimeter', 123, anyUuid, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(4);
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
    expect(this.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `InventoryAdjustment` (`description`, `createdAt`, `id`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['some description', 1, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`, `id`) VALUES (?, ?, ?, ?), (?, ?, ?, ?) RETURNING `id` `id`',
      [50, 1, anyUuid, anyUuid, 300, 1, anyUuid, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(4);
  }

  async shouldUpdateMany() {
    await this.querier.updateMany(User, { $where: { companyId: '4' } }, { name: 'Hola', updatedAt: 1 });
    expect(this.run).toHaveBeenNthCalledWith(1, 'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `companyId` = ?', [
      'Hola',
      1,
      '4',
    ]);
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  /** One statement: the next version in the SET, the one the payload carried flat in the WHERE. */
  async shouldUpdateAVersionedRowInOneStatement() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'first' });
    this.run.mockClear();

    await this.querier.updateOneById(VersionedNote, id, { title: 'second', version: 0 });
    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'UPDATE `VersionedNote` SET `title` = ?, `version` = ? WHERE `id` = ? AND `version` = ? AND `deletedAt` IS NULL',
      ['second', 1, id, 0],
    );
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  /** A restore undoes the delete's stamp, so it matches no version and bumps none. */
  async shouldRestoreAVersionedRowWithoutItsVersion() {
    await this.querier.restoreOneById(VersionedNote, 'abc');
    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'UPDATE `VersionedNote` SET `deletedAt` = ? WHERE `id` = ? AND `deletedAt` IS NOT NULL',
      [null, 'abc'],
    );
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  /** The run-time half of the compile-time rule, for a payload that reached the querier as client JSON. */
  async shouldRefuseAVersionedUpdateCarryingNoVersion() {
    await expect(this.querier.updateOneById(VersionedNote, 'abc', { title: 'x' } as never)).rejects.toThrow(
      "an update of 'VersionedNote' carries no 'version'",
    );
  }

  /** A settled write is two statements, and the race lives in the gap between them. */
  async shouldRefuseAVersionedUpdateThatWouldSettleFirst() {
    await expect(
      this.querier.updateMany(VersionedNote, { $where: { id: 'abc' }, $limit: 1 }, { title: 'x', version: 0 }),
    ).rejects.toThrow("cannot update 'VersionedNote' this way");
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, '5', { companyId: '123', updatedAt: 1 });
    expect(this.run).toHaveBeenNthCalledWith(1, 'UPDATE `User` SET `companyId` = ?, `updatedAt` = ? WHERE `id` = ?', [
      '123',
      1,
      '5',
    ]);
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    const id = await this.querier.insertOne(User, { createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `User` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, id],
    );

    await this.querier.updateOneById(User, id, {
      name: 'something',
      updatedAt: 1,
      profile: { picture: 'xyz', createdAt: 1 },
    });

    expect(this.run).toHaveBeenNthCalledWith(3, 'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` IN (?)', [
      'something',
      1,
      id,
    ]);
    // The parent owns its one-to-one child, so an update replaces it: without the delete the previous
    // row stayed behind and a `$populate` had two to choose from.
    expect(this.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `user_profile` WHERE `creatorId` IN (?)', [id]);
    expect(this.run).toHaveBeenNthCalledWith(
      5,
      'INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`, `pk`) VALUES (?, ?, ?, ?) RETURNING `pk` `id`',
      ['xyz', 1, id, anyUuid],
    );

    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = ?', [id]);

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(6);
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    const id = await this.querier.insertOne(User, { createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `User` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, id],
    );

    await this.querier.updateOneById(User, id, {
      name: 'something',
      updatedAt: 1,
      profile: null,
    });

    expect(this.run).toHaveBeenNthCalledWith(3, 'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` IN (?)', [
      'something',
      1,
      id,
    ]);
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = ?', [id]);
    expect(this.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `user_profile` WHERE `creatorId` IN (?)', [id]);

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(5);
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    const id = await this.querier.insertOne(InventoryAdjustment, { createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, id],
    );

    await this.querier.updateOneById(InventoryAdjustment, id, {
      description: 'some description',
      updatedAt: 1,
      itemAdjustments: [
        { buyPrice: 50, createdAt: 1 },
        { buyPrice: 300, createdAt: 1 },
      ],
    });

    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'UPDATE `InventoryAdjustment` SET `description` = ?, `updatedAt` = ? WHERE `id` IN (?)',
      ['some description', 1, id],
    );
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = ?', [id]);
    expect(this.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?)', [
      id,
    ]);
    expect(this.run).toHaveBeenNthCalledWith(
      5,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`, `id`) VALUES (?, ?, ?, ?), (?, ?, ?, ?) RETURNING `id` `id`',
      [50, 1, anyUuid, anyUuid, 300, 1, anyUuid, anyUuid],
    );

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(6);
  }

  /**
   * Two matched rows share one relation payload, so the counts are the assertion: naming each parent in
   * a `DELETE` and an `INSERT` of its own is what made this two statements per matched row.
   */
  async shouldUpdateManyAndCascadeOneToManyInOneStatementEach() {
    await this.pool.insertOne(Company, { id: '1' });
    await this.querier.insertMany(InventoryAdjustment, [
      { companyId: '1', createdAt: 1 },
      { companyId: '1', createdAt: 1 },
    ]);

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: { companyId: '1' } },
      { description: 'some description', updatedAt: 1, itemAdjustments: [{ buyPrice: 50, createdAt: 1 }] },
    );

    expect(this.run).toHaveBeenNthCalledWith(
      4,
      'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?, ?)',
      [anyUuid, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      5,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`, `id`) VALUES (?, ?, ?, ?), (?, ?, ?, ?) RETURNING `id` `id`',
      [50, 1, anyUuid, anyUuid, 50, 1, anyUuid, anyUuid],
    );

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(6);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    const id = await this.querier.insertOne(InventoryAdjustment, { createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, id],
    );

    await this.querier.updateOneById(InventoryAdjustment, id, {
      description: 'some description',
      updatedAt: 1,
      itemAdjustments: null,
    });

    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'UPDATE `InventoryAdjustment` SET `description` = ?, `updatedAt` = ? WHERE `id` IN (?)',
      ['some description', 1, id],
    );
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = ?', [id]);
    expect(this.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?)', [
      id,
    ]);

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(5);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.pool.insertOne(Company, { id: '1' });
    const id = await this.querier.insertOne(InventoryAdjustment, { companyId: '1', createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`companyId`, `createdAt`, `id`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['1', 1, anyUuid],
    );

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: { companyId: '1' } },
      {
        description: 'some description',
        updatedAt: 1,
        itemAdjustments: null,
      },
    );

    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'UPDATE `InventoryAdjustment` SET `description` = ?, `updatedAt` = ? WHERE `id` IN (?)',
      ['some description', 1, id],
    );
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `companyId` = ?', ['1']);
    expect(this.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (?)', [
      id,
    ]);

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(5);
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
    expect(this.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `Item` (`name`, `createdAt`, `id`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['item one', 1, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `Tag` (`name`, `createdAt`, `id`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      ['tag one', 1, anyUuid, 'tag two', 1, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      4,
      'INSERT INTO `ItemTag` (`itemId`, `tagId`, `id`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      [anyUuid, anyUuid, anyUuid, anyUuid, anyUuid, anyUuid],
    );

    expect(this.run).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(5);
  }

  async shouldUpdateAndCascadeManyToManyInserts() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `Item` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, anyUuid],
    );

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

    expect(this.run).toHaveBeenNthCalledWith(3, 'UPDATE `Item` SET `name` = ?, `updatedAt` = ? WHERE `id` IN (?)', [
      'item one',
      1,
      anyUuid,
    ]);
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = ?', [anyUuid]);
    // The tags first, for the ids the links point at; then only the links that differ are written.
    expect(this.run).toHaveBeenNthCalledWith(
      4,
      'INSERT INTO `Tag` (`name`, `createdAt`, `id`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      ['tag one', 1, anyUuid, 'tag two', 1, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      5,
      'DELETE FROM `ItemTag` WHERE `itemId` IN (?) AND `tagId` NOT IN (?, ?)',
      [anyUuid, anyUuid, anyUuid],
    );
    expect(this.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id`, `itemId`, `tagId` FROM `ItemTag` WHERE `itemId` IN (?) AND `tagId` IN (?, ?)',
      [anyUuid, anyUuid, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      6,
      'INSERT INTO `ItemTag` (`itemId`, `tagId`, `id`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      [anyUuid, anyUuid, anyUuid, anyUuid, anyUuid, anyUuid],
    );

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(2);
    expect(this.run).toHaveBeenCalledTimes(7);
  }

  async shouldUpdateAndCascadeManyToManyLinks() {
    await this.pool.insertMany(Tag, [{ id: '22' }, { id: '33' }]);
    const id = await this.querier.insertOne(Item, { createdAt: 1 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `Item` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, anyUuid],
    );

    await this.querier.updateOneById(Item, id, {
      name: 'item one',
      tags: [{ id: '22' }, { id: '33' }],
      updatedAt: 1,
    });

    expect(this.run).toHaveBeenNthCalledWith(3, 'UPDATE `Item` SET `name` = ?, `updatedAt` = ? WHERE `id` IN (?)', [
      'item one',
      1,
      anyUuid,
    ]);
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = ?', [anyUuid]);
    // A tag naming only its key is a link, so nothing is written to `Tag`.
    expect(this.run).toHaveBeenNthCalledWith(
      4,
      'DELETE FROM `ItemTag` WHERE `itemId` IN (?) AND `tagId` NOT IN (?, ?)',
      [anyUuid, '22', '33'],
    );
    expect(this.all).toHaveBeenNthCalledWith(
      2,
      'SELECT `id`, `itemId`, `tagId` FROM `ItemTag` WHERE `itemId` IN (?) AND `tagId` IN (?, ?)',
      [anyUuid, '22', '33'],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      5,
      'INSERT INTO `ItemTag` (`itemId`, `tagId`, `id`) VALUES (?, ?, ?), (?, ?, ?) RETURNING `id` `id`',
      [anyUuid, '22', anyUuid, anyUuid, '33', anyUuid],
    );

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(2);
    expect(this.run).toHaveBeenCalledTimes(6);
  }

  async shouldDeleteOneAndCascadeManyToManyDeletes() {
    await this.shouldInsertOneAndCascadeManyToManyInserts();

    vi.clearAllMocks();

    const [itemId] = await this.querier.findMany(Item, { $select: { id: true } });
    await this.querier.deleteOneById(Item, itemId.id);

    expect(this.all).toHaveBeenNthCalledWith(2, 'SELECT `id` FROM `Item` WHERE `id` = ?', [itemId.id]);
    // Children before the parent: they hold the foreign key, so the reverse order is rejected by any
    // schema that declares the constraint. Asserted by position on purpose.
    expect(this.run.mock.calls).toEqual([
      ['BEGIN TRANSACTION'],
      ['DELETE FROM `ItemTag` WHERE `itemId` IN (?)', [itemId.id]],
      ['DELETE FROM `Item` WHERE `id` IN (?)', [itemId.id]],
      ['COMMIT'],
    ]);
    expect(this.all).toHaveBeenCalledTimes(2);
  }

  async shouldDeleteOneAndNoCascadeManyToManyDeletes() {
    await this.shouldInsertOneAndCascadeManyToManyInserts();

    vi.clearAllMocks();

    await this.querier.deleteOneById(Tag, '1');

    expect(this.run).toHaveBeenNthCalledWith(1, 'DELETE FROM `Tag` WHERE `id` = ?', ['1']);

    expect(this.all).toHaveBeenCalledTimes(0);
    expect(this.run).toHaveBeenCalledTimes(1);
  }

  async shouldDeleteOneById() {
    const id = await this.querier.insertOne(User, { createdAt: 1, profile: { createdAt: 1 } });

    expect(this.run).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO `User` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [1, anyUuid],
    );
    expect(this.run).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO `user_profile` (`createdAt`, `creatorId`, `pk`) VALUES (?, ?, ?) RETURNING `pk` `id`',
      [1, anyUuid, anyUuid],
    );

    await this.querier.deleteOneById(User, id);

    // Children before the parent; see shouldDeleteOneAndCascadeManyToManyDeletes.
    expect(this.run).toHaveBeenNthCalledWith(6, 'DELETE FROM `user_profile` WHERE `creatorId` IN (?)', [anyUuid]);
    expect(this.run).toHaveBeenNthCalledWith(7, 'DELETE FROM `User` WHERE `id` IN (?)', [anyUuid]);
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = ?', [anyUuid]);

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(8);
  }

  async shouldDeleteMany() {
    await this.querier.insertOne(User, { createdAt: 123 });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `User` (`createdAt`, `id`) VALUES (?, ?) RETURNING `id` `id`',
      [123, anyUuid],
    );

    await this.querier.deleteMany(User, { $where: { createdAt: 123 } });

    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT `id` FROM `User` WHERE `createdAt` = ?', [123]);
    expect(this.run).toHaveBeenNthCalledWith(3, 'DELETE FROM `user_profile` WHERE `creatorId` IN (?)', [anyUuid]);
    expect(this.run).toHaveBeenNthCalledWith(4, 'DELETE FROM `User` WHERE `id` IN (?)', [anyUuid]);

    expect(this.run).toHaveBeenNthCalledWith(2, 'BEGIN TRANSACTION');
    expect(this.run).toHaveBeenLastCalledWith('COMMIT');
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(5);
  }

  /**
   * A delete whose predicate reaches through a relation is the case that makes the single-statement
   * path safe at all: `where` compiles a relation condition to a correlated `EXISTS`, which a DELETE
   * takes on every engine, rather than to a join, which it would not.
   */
  async shouldDeleteManyByARelationCondition() {
    await this.querier.deleteMany(Tag, { $where: { company: { name: 'acme' } } });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM `Tag` WHERE EXISTS (SELECT 1 FROM `Company` `company` WHERE `company`.`id` = `Tag`.`companyId` AND `company`.`name` = ?)',
      ['acme'],
    );
    expect(this.all).toHaveBeenCalledTimes(0);
  }

  async shouldCount() {
    await this.querier.count(User, { $where: { companyId: '123' } });
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT COUNT(*) `_uql_value` FROM `User` WHERE `companyId` = ?', [
      '123',
    ]);
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  /** A paged count settles ids instead of counting: an `OFFSET` would push a `COUNT(*)` row away. */
  async shouldCountAPage() {
    await this.querier.count(User, { $where: { companyId: '123' }, $skip: 2, $limit: 5 });
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) `_uql_value` FROM (SELECT `id` FROM `User` WHERE `companyId` = ? LIMIT 5 OFFSET 2) `_uql_rows`',
      ['123'],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  /** `count` takes no `$sort`, but `/http` passes one on unchecked: it never reaches the SELECT as an `ORDER BY`. */
  async shouldCountDroppingASmuggledSort() {
    const sorted: QuerySearch<User> = { $where: { companyId: '123' }, $sort: { name: 1 }, $limit: 5 };
    await this.querier.count(User, sorted);
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) `_uql_value` FROM (SELECT `id` FROM `User` WHERE `companyId` = ? LIMIT 5) `_uql_rows`',
      ['123'],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
  }

  /** The cheap shape is the point: a count of one capped id scan, never of every match. */
  async shouldExistsAsACappedIdScan() {
    await this.querier.exists(User, { $where: { companyId: '123' } });
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) `_uql_value` FROM (SELECT `id` FROM `User` WHERE `companyId` = ? LIMIT 1) `_uql_rows`',
      ['123'],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  /**
   * A `$count` is a correlated subquery of the parent's own statement, so a page of three costs one
   * statement, as a page of three hundred does - never one per row.
   */
  async shouldCountARelationInsideItsParentStatement() {
    this.all.mockResolvedValueOnce([
      { id: 1, '_count.users': 5 },
      { id: 2, '_count.users': 0 },
      { id: 3, '_count.users': 2 },
    ]);

    const found = await this.querier.findMany(User, { $select: { id: true }, $count: { users: true } });

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `id`, (SELECT COUNT(*) FROM `User` `users` WHERE `users`.`creatorId` = `User`.`id`) `_count.users` FROM `User`',
      [],
    );
    expect(found.map((it) => it._count.users)).toEqual([5, 0, 2]);
  }

  async shouldUseTransaction() {
    await this.querier.beginTransaction();
    await this.querier.updateOneById(User, '5', { name: 'Hola', updatedAt: 1 });
    await this.querier.commitTransaction();
    expect(this.querier.hasOpenTransaction).toBe(false);
    expect(this.run.mock.calls).toEqual([
      ['BEGIN TRANSACTION'],
      ['UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?', ['Hola', 1, '5']],
      ['COMMIT'],
    ]);
    expect(this.all).toHaveBeenCalledTimes(0);
  }

  async shouldUseTransactionCallback() {
    await this.querier.transaction(async () => {
      await this.querier.updateOneById(User, '5', { name: 'Hola', updatedAt: 1 });
    });
    expect(this.run.mock.calls).toEqual([
      ['BEGIN TRANSACTION'],
      ['UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?', ['Hola', 1, '5']],
      ['COMMIT'],
    ]);
    expect(this.all).toHaveBeenCalledTimes(0);
  }

  async shouldUseTransactionCallbackWithIsolationLevel() {
    await this.querier.transaction(
      async () => {
        await this.querier.updateOneById(User, '5', { name: 'Hola', updatedAt: 1 });
      },
      { isolationLevel: 'read committed' },
    );

    const begin = this.querier.dialect.getBeginTransactionStatements('read committed');
    expect(this.run.mock.calls).toEqual([
      ...begin.map((sql) => [sql]),
      ['UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?', ['Hola', 1, '5']],
      ['COMMIT'],
    ]);
  }

  async shouldBeginTransactionWithoutIsolationLevel() {
    await this.querier.transaction(async () => {});
    expect(this.run.mock.calls).toEqual([
      [this.querier.dialect.beginTransactionCommand],
      [this.querier.dialect.commitTransactionCommand],
    ]);
  }

  async shouldRollBackAndRethrowAnErrorInTheCallback() {
    const prom = this.querier.transaction(async () => {
      throw new TypeError('some error');
    });
    await expect(prom).rejects.toThrow('some error');
    expect(this.run.mock.calls).toEqual([['BEGIN TRANSACTION'], ['ROLLBACK']]);
    expect(this.all).toHaveBeenCalledTimes(0);
  }

  async shouldReuseTransactionWhenNested() {
    await this.querier.transaction(async () => {
      const innerResult = await this.querier.transaction(async () => {
        await this.querier.updateOneById(User, '5', { name: 'nested' });
        return 42;
      });

      expect(innerResult).toBe(42);
    });

    expect(this.run.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN TRANSACTION',
      'SAVEPOINT _uql_sp1',
      'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?',
      'RELEASE SAVEPOINT _uql_sp1',
      'COMMIT',
    ]);
  }

  async shouldRollbackEntireTransactionWhenNestedThrows() {
    const prom = this.querier.transaction(async () => {
      await this.querier.transaction(async () => {
        throw new TypeError('inner error');
      });
    });

    await expect(prom).rejects.toThrow('inner error');
  }

  async shouldIgnoreIsolationLevelWhenReusing() {
    await this.querier.transaction(
      async () => {
        // Inner call specifies a different isolation level - should be ignored
        await this.querier.transaction(
          async () => {
            await this.querier.updateOneById(User, '5', { name: 'nested' });
          },
          { isolationLevel: 'read uncommitted' },
        );
      },
      { isolationLevel: 'serializable' },
    );

    // Only the outer isolation level SQL should have been emitted
    const outerStatements = this.querier.dialect.getBeginTransactionStatements('serializable');
    for (let i = 0; i < outerStatements.length; i++) {
      expect(this.run).toHaveBeenNthCalledWith(i + 1, outerStatements[i]);
    }

    // No 'read uncommitted' statements should appear
    const innerStatements = this.querier.dialect.getBeginTransactionStatements('read uncommitted');
    for (const stmt of innerStatements.filter((inner) => !outerStatements.includes(inner))) {
      expect(this.run).not.toHaveBeenCalledWith(stmt);
    }
  }

  async shouldReuseDeeplyNestedTransactions() {
    const result = await this.querier.transaction(async () => {
      return this.querier.transaction(async () => {
        return this.querier.transaction(async () => {
          await this.querier.updateOneById(User, '5', { name: 'deep' });
          return 'deep-value';
        });
      });
    });

    expect(result).toBe('deep-value');
    expect(this.run.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN TRANSACTION',
      'SAVEPOINT _uql_sp1',
      'SAVEPOINT _uql_sp2',
      'UPDATE `User` SET `name` = ?, `updatedAt` = ? WHERE `id` = ?',
      'RELEASE SAVEPOINT _uql_sp2',
      'RELEASE SAVEPOINT _uql_sp1',
      'COMMIT',
    ]);
  }

  async shouldBeIdempotentRelease() {
    await this.querier.release();
    await expect(this.querier.release()).resolves.toBeUndefined();
  }

  async shouldFindOneAndSelectOneToManyWithObjectSelect() {
    await this.querier.insertOne(InventoryAdjustment, {
      id: '999',
      description: 'test adjustment',
      createdAt: 1,
    });

    expect(this.run).toHaveBeenNthCalledWith(
      1,
      'INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (?, ?, ?) RETURNING `id` `id`',
      ['999', 'test adjustment', 1],
    );

    // Use object-style $select for the relation (not array)
    await this.querier.findMany(InventoryAdjustment, {
      $select: {
        id: true,
      },
      $populate: {
        itemAdjustments: { $select: { buyPrice: true, itemId: true } },
      },
      $where: { id: '999' },
    });

    expect(this.all).toHaveBeenNthCalledWith(
      1,
      "SELECT `InventoryAdjustment`.`id`, (SELECT json_group_array(json_object('buyPrice', `itemAdjustments`.`buyPrice`, 'itemId', `itemAdjustments`.`itemId`))" +
        ' FROM (SELECT CAST(`itemAdjustments`.`buyPrice` AS TEXT) `buyPrice`, `itemAdjustments`.`itemId` FROM `ItemAdjustment` `itemAdjustments`' +
        ' WHERE `itemAdjustments`.`inventoryAdjustmentId` = `InventoryAdjustment`.`id`) `itemAdjustments`) `itemAdjustments`' +
        ' FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`id` = ?',
      ['999'],
    );

    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(1);
  }
  async shouldAggregate() {
    await this.querier.aggregate(User, {
      $select: { total: { $count: '*' } },
    });
    expect(this.all).toHaveBeenNthCalledWith(1, 'SELECT COUNT(*) `total` FROM `User`', []);
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldAggregateWithGroupAndHaving() {
    await this.pool.insertMany(Company, [{ id: '1' }, { id: '2' }]);
    await this.querier.insertMany(User, [
      { companyId: '1', createdAt: 1 },
      { companyId: '1', createdAt: 2 },
      { companyId: '2', createdAt: 3 },
    ]);

    vi.clearAllMocks();

    await this.querier.aggregate(User, {
      $group: { companyId: true },
      $select: { cnt: { $count: '*' } },
      $having: { cnt: { $gt: 1 } },
      $sort: { cnt: -1 },
    });

    expect(this.all).toHaveBeenNthCalledWith(
      1,
      'SELECT `companyId`, COUNT(*) `cnt` FROM `User` GROUP BY `companyId` HAVING COUNT(*) > ? ORDER BY COUNT(*) DESC',
      [1],
    );
    expect(this.all).toHaveBeenCalledTimes(1);
    expect(this.run).toHaveBeenCalledTimes(0);
  }

  async shouldDistinct() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice1@test.com', createdAt: 1 },
      { name: 'Alice', email: 'alice2@test.com', createdAt: 1 },
      { name: 'Bob', email: 'bob@test.com', createdAt: 1 },
    ]);

    vi.clearAllMocks();

    const distinctRows = await this.querier.findMany(User, {
      $select: { name: true },
      $distinct: true,
    });

    expect(this.all).toHaveBeenCalledWith('SELECT DISTINCT `name` FROM `User`', []);
    expect(distinctRows).toHaveLength(2);
    expect(distinctRows.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
  }

  async shouldFindManyStream() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com', createdAt: 1 },
      { name: 'Bob', email: 'bob@test.com', createdAt: 1 },
    ]);

    vi.clearAllMocks();

    const collected: User[] = [];
    for await (const row of this.querier.findManyStream(User, {
      $select: { name: true },
    })) {
      collected.push(row);
    }

    expect(collected).toHaveLength(2);
    expect(collected.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
  }

  /** A to-many streams with each row: it is read inside the row's own statement. */
  async shouldStreamAToManyRelation() {
    const creatorId = await this.querier.insertOne(User, { name: 'creator' });
    await this.querier.insertMany(User, [
      { name: 'b', creatorId },
      { name: 'a', creatorId },
    ]);

    const streamed: User[] = [];
    for await (const row of this.querier.findManyStream(User, {
      $select: { name: true },
      $where: { id: creatorId },
      $populate: { users: { $select: { name: true }, $sort: { name: 1 } } },
    })) {
      streamed.push(row);
    }

    expect(streamed).toEqual([{ name: 'creator', users: [{ name: 'a' }, { name: 'b' }] }]);
  }
}
