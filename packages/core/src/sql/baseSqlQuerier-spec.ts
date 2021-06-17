import { User, InventoryAdjustment, Spec, Item, Tag, MeasureUnit } from '../test';
import { QuerierPoolConnection, QueryUpdateResult } from '../type';
import { BaseSqlQuerier } from './baseSqlQuerier';

export class BaseSqlQuerierSpec implements Spec {
  querier: BaseSqlQuerier;

  constructor(private readonly querierConstructor: new (conn: QuerierPoolConnection) => BaseSqlQuerier) {}

  beforeEach() {
    const runRes: QueryUpdateResult = { changes: 1, firstId: 1 };
    this.querier = new this.querierConstructor({
      all: jest.fn(() => Promise.resolve([])),
      run: jest.fn(() => Promise.resolve(runRes)),
      release: jest.fn(() => Promise.resolve()),
      end: jest.fn(() => Promise.resolve()),
    });
  }

  afterEach() {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  }

  async shouldFindOneById() {
    await this.querier.findOneById(User, 1);
    expect(this.querier.conn.all).nthCalledWith(
      1,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `name`, `email`, `password` FROM `User` WHERE `id` = 1 LIMIT 1'
    );
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOne() {
    await this.querier.findOne(User, { $filter: { companyId: 123 }, $project: ['id', 'name'] });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id`, `name` FROM `User` WHERE `companyId` = 123 LIMIT 1');
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOneAndPopulateOneToMany() {
    const mock: InventoryAdjustment[] = [
      { id: 123, description: 'something a', creatorId: 1 },
      { id: 456, description: 'something b', creatorId: 1 },
    ];
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mock);

    await this.querier.findOne(InventoryAdjustment, {
      $project: ['id'],
      $filter: { creatorId: 1 },
      $populate: { itemAdjustments: {} },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,

      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`creatorId` = 1 LIMIT 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,

      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ', `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (123, 456)'
    );
    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOneAndPopulateOneToManyWithSpecifiedFields() {
    const mock: InventoryAdjustment[] = [
      { id: 123, description: 'something a', creatorId: 1 },
      { id: 456, description: 'something b', creatorId: 1 },
    ];
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mock);

    await this.querier.findOne(InventoryAdjustment, {
      $project: ['id'],
      $filter: { creatorId: 1 },
      $populate: { itemAdjustments: { $project: ['buyPrice'] } },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,

      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`creatorId` = 1 LIMIT 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,

      'SELECT `buyPrice`, `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (123, 456)'
    );
    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindManyAndPopulateOneToMany() {
    const mock: InventoryAdjustment[] = [
      { id: 123, description: 'something a', creatorId: 1 },
      { id: 456, description: 'something b', creatorId: 1 },
    ];

    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mock);

    await this.querier.findMany(InventoryAdjustment, {
      $project: ['id'],
      $filter: { creatorId: 1 },
      $populate: { itemAdjustments: {} },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,

      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`creatorId` = 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,

      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ', `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (123, 456)'
    );
    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOneAndPopulateManyToMany() {
    const mock: Item[] = [{ id: 123, name: 'something a' }];
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mock);

    await this.querier.findOne(Item, {
      $project: ['id', 'name'],
      $populate: { tags: { $project: ['id'] } },
    });

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `Item`.`id`, `Item`.`name` FROM `Item` LIMIT 1');
    expect(this.querier.conn.all).nthCalledWith(
      2,

      'SELECT `ItemTag`.`itemId`, `tag`.`id` `tag.id`' +
        ' FROM `ItemTag` INNER JOIN `Tag` `tag` ON `tag`.`id` = `ItemTag`.`tagId`' +
        ' WHERE `ItemTag`.`itemId` IN (123)'
    );
    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindMany() {
    await this.querier.findMany(User, {
      $project: { id: 1, name: 1 },
      $filter: { companyId: 123 },
      $limit: 100,
    });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id`, `name` FROM `User` WHERE `companyId` = 123 LIMIT 100');
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { companyId: 123, createdAt: 1 });
    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `User` (`companyId`, `createdAt`) VALUES (123, 1)');
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      createdAt: 1,
      profile: { picture: 'abc', createdAt: 1 },
    });
    expect(this.querier.conn.run).nthCalledWith(1, "INSERT INTO `User` (`name`, `createdAt`) VALUES ('some name', 1)");
    expect(this.querier.conn.run).nthCalledWith(
      2,

      "INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`) VALUES ('abc', 1, 1)"
    );
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldInsertOneAndCascadeManyToOne() {
    await this.querier.insertOne(MeasureUnit, {
      name: 'Centimeter',
      createdAt: 123,
      category: { name: 'Metric', createdAt: 123 },
    });

    expect(this.querier.conn.run).nthCalledWith(
      1,
      "INSERT INTO `MeasureUnit` (`name`, `createdAt`) VALUES ('Centimeter', 123)"
    );
    expect(this.querier.conn.run).nthCalledWith(
      2,
      "INSERT INTO `MeasureUnitCategory` (`name`, `createdAt`) VALUES ('Metric', 123)"
    );
    expect(this.querier.conn.run).nthCalledWith(
      3,
      expect.toMatch(/^UPDATE `MeasureUnit` SET `categoryId` = 1, `updatedAt` = \d+ WHERE `id` = 1$/)
    );
    expect(this.querier.conn.run).toBeCalledTimes(3);
    expect(this.querier.conn.all).toBeCalledTimes(0);
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
    expect(this.querier.conn.run).nthCalledWith(
      1,
      "INSERT INTO `InventoryAdjustment` (`description`, `createdAt`) VALUES ('some description', 1)"
    );
    expect(this.querier.conn.run).nthCalledWith(
      2,

      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (50, 1, 1), (300, 1, 1)'
    );
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateMany() {
    await this.querier.updateMany(User, { name: 'Hola', updatedAt: 1 }, { $filter: { id: 5 } });
    expect(this.querier.conn.run).nthCalledWith(1, "UPDATE `User` SET `name` = 'Hola', `updatedAt` = 1 WHERE `id` = 5");
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, { companyId: 123, updatedAt: 1 }, 5);
    expect(this.querier.conn.run).nthCalledWith(
      1,
      'UPDATE `User` SET `companyId` = 123, `updatedAt` = 1 WHERE `id` = 5'
    );
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      User,
      {
        name: 'something',
        updatedAt: 1,
        profile: { picture: 'xyz', createdAt: 1 },
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      "UPDATE `User` SET `name` = 'something', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(
      2,

      "INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`) VALUES ('xyz', 1, 1)"
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      User,
      {
        name: 'something',
        updatedAt: 1,
        profile: null,
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      "UPDATE `User` SET `name` = 'something', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `user_profile` WHERE `creatorId` = 1');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      InventoryAdjustment,
      {
        description: 'some description',
        updatedAt: 1,
        itemAdjustments: [
          { buyPrice: 50, createdAt: 1 },
          { buyPrice: 300, createdAt: 1 },
        ],
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,

      "UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,

      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (50, 1, 1), (300, 1, 1)'
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = 1');
    expect(this.querier.conn.run).toBeCalledTimes(3);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      InventoryAdjustment,
      {
        description: 'some description',
        updatedAt: 1,
        itemAdjustments: null,
      },
      1
    );

    expect(this.querier.conn.run).nthCalledWith(
      1,
      "UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateMany(
      InventoryAdjustment,
      {
        description: 'some description',
        updatedAt: 1,
        itemAdjustments: null,
      },
      { $filter: { companyId: 1 } }
    );

    expect(this.querier.conn.run).nthCalledWith(
      1,

      "UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = 1 WHERE `companyId` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `companyId` = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
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
    expect(this.querier.conn.run).nthCalledWith(1, "INSERT INTO `Item` (`name`, `createdAt`) VALUES ('item one', 1)");
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemTag` WHERE `itemId` = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,

      "INSERT INTO `Tag` (`name`, `createdAt`) VALUES ('tag one', 1), ('tag two', 1)"
    );
    expect(this.querier.conn.run).nthCalledWith(4, 'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (1, 1), (1, 2)');
    expect(this.querier.conn.run).toBeCalledTimes(4);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateAndCascadeManyToManyInserts() {
    const mock: Item[] = [{ id: 1 }];

    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mock);

    await this.querier.updateOneById(
      Item,
      {
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
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      "UPDATE `Item` SET `name` = 'item one', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemTag` WHERE `itemId` = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,

      "INSERT INTO `Tag` (`name`, `createdAt`) VALUES ('tag one', 1), ('tag two', 1)"
    );
    expect(this.querier.conn.run).nthCalledWith(4, 'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (1, 1), (1, 2)');
    expect(this.querier.conn.run).toBeCalledTimes(4);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateAndCascadeManyToManyLinks() {
    const mockItem: Item[] = [{ id: 1 }];
    const mockTags: Tag[] = [{ id: 22 }, { id: 33 }];

    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mockItem);
    jest.spyOn(this.querier.conn, 'run').mockResolvedValueOnce({ changes: 2, firstId: mockTags[0].id });

    await this.querier.updateOneById(
      Item,
      {
        name: 'item one',
        tags: mockTags,
        updatedAt: 1,
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      "UPDATE `Item` SET `name` = 'item one', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemTag` WHERE `itemId` = 1');
    expect(this.querier.conn.run).nthCalledWith(3, 'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (1, 22), (1, 33)');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = 1');
    expect(this.querier.conn.run).toBeCalledTimes(3);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldDeleteOneById() {
    await expect(this.querier.deleteOneById(User, 5));
    expect(this.querier.conn.run).nthCalledWith(1, 'DELETE FROM `User` WHERE `id` = 5');
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldDeleteMany() {
    await this.querier.deleteMany(User, { $filter: { companyId: 123 } });
    expect(this.querier.conn.run).nthCalledWith(1, 'DELETE FROM `User` WHERE `companyId` = 123');
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldCount() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ count: 1 }]);
    await this.querier.count(User, { $filter: { companyId: 123 } });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT COUNT(*) `count` FROM `User` WHERE `companyId` = 123');
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldUseTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.conn.run).toBeCalledWith(this.querier.dialect.beginTransactionCommand);
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.updateMany(User, { name: 'Hola' }, { $filter: { id: 5 } });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.commitTransaction();
    expect(this.querier.conn.run).toBeCalledWith('COMMIT');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.release();
    expect(this.querier.conn.run).toBeCalledTimes(3);
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.hasOpenTransaction).toBeFalsy();
  }

  async shouldThrowIfTransactionIsPending() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldThrowIfCommitWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.commitTransaction()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.conn.run).toBeCalledTimes(0);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldThrowIfRollbackWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.conn.run).toBeCalledTimes(0);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldThrowIfReleaseWithPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.updateMany(User, { name: 'some name' }, { $filter: { id: 5 } });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }
}
