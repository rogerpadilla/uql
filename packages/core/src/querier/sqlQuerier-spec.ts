import { raw } from '@uql/core/util/raw';
import { User, InventoryAdjustment, Spec, Item, Tag, MeasureUnit, dropTables, createTables, cleanTables, ItemAdjustment } from '@uql/core/test';
import { QuerierPool, QueryFilter } from '@uql/core/type';
import { SqlQuerier } from './sqlQuerier';

export class BaseSqlQuerierSpec implements Spec {
  readonly primaryKeyType: string = 'INTEGER PRIMARY KEY';
  querier: SqlQuerier;

  constructor(readonly pool: QuerierPool<SqlQuerier>) {}

  async beforeAll() {
    this.querier = await this.pool.getQuerier();
    await dropTables(this.querier);
    await createTables(this.querier, this.primaryKeyType);
    await this.querier.release();
  }

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
    await cleanTables(this.querier);
    jest.spyOn(this.querier.conn, 'all');
    jest.spyOn(this.querier.conn, 'run');
  }

  async afterEach() {
    jest.restoreAllMocks();
    await this.querier.release();
  }

  async afterAll() {
    await this.pool.end();
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
    await this.querier.findOne(User, { $project: ['id', 'name'], $filter: { companyId: 123 } });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id`, `name` FROM `User` WHERE `companyId` = 123 LIMIT 1');
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOneAndProjectOneToMany() {
    await this.querier.insertMany(InventoryAdjustment, [
      {
        id: 123,
        createdAt: 1,
      },
      { id: 456, createdAt: 1 },
    ]);

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `InventoryAdjustment` (`id`, `createdAt`) VALUES (123, 1), (456, 1)');

    await this.querier.findMany(InventoryAdjustment, {
      $project: ['id', 'itemAdjustments'],
      $filter: { createdAt: 1 },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ', `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (123, 456)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldFindAndProjectRaw() {
    await this.querier.findMany(InventoryAdjustment, {
      $project: {
        itemAdjustments: {
          $project: {
            item: {
              $project: {
                companyId: true,
                total: raw(({ escapedPrefix, dialect }) => `SUM(${escapedPrefix}${dialect.escapeId('salePrice')})`),
              },
            },
          },
          $limit: 100,
          $sort: { createdAt: -1 },
        },
      },
    });

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment`');
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `ItemAdjustment`.`id`, `ItemAdjustment`.`inventoryAdjustmentId`' +
        ', `item`.`id` `item.id`, `item`.`companyId` `item.companyId`, SUM(`item`.`salePrice`) `item.total`' +
        ' FROM `ItemAdjustment` LEFT JOIN `Item` `item` ON `item`.`id` = `ItemAdjustment`.`itemId`' +
        ' WHERE `ItemAdjustment`.`inventoryAdjustmentId` IN ()' +
        ' ORDER BY `ItemAdjustment`.`createdAt`' +
        ' DESC LIMIT 100'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldVirtualField() {
    await this.querier.findMany(Item, {
      $project: {
        id: 1,
      },
      $filter: {
        tagsCount: { $gte: 10 },
      },
    });

    expect(this.querier.conn.all).toBeCalledWith(
      'SELECT `id` FROM `Item` WHERE (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `id`) >= 10'
    );

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
    jest.clearAllMocks();

    await this.querier.findMany(Item, {
      $project: {
        id: 1,
        name: 1,
        code: 1,
        tagsCount: 1,
        measureUnit: {
          $project: { id: 1, name: 1, categoryId: 1, category: ['name'] },
        },
      },
      $limit: 100,
    });

    expect(this.querier.conn.all).toBeCalledWith(
      'SELECT `Item`.`id`, `Item`.`name`, `Item`.`code`' +
        ', (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`itemId` = `Item`.`id`) `tagsCount`' +
        ', `measureUnit`.`id` `measureUnit.id`, `measureUnit`.`name` `measureUnit.name`, `measureUnit`.`categoryId` `measureUnit.categoryId`' +
        ', `measureUnit.category`.`id` `measureUnit.category.id`, `measureUnit.category`.`name` `measureUnit.category.name`' +
        ' FROM `Item` LEFT JOIN `MeasureUnit` `measureUnit` ON `measureUnit`.`id` = `Item`.`measureUnitId`' +
        ' LEFT JOIN `MeasureUnitCategory` `measureUnit.category` ON `measureUnit.category`.`id` = `measureUnit`.`categoryId`' +
        ' LIMIT 100'
    );

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);

    jest.clearAllMocks();

    await this.querier.findMany(Tag, {
      $project: {
        id: 1,
        itemsCount: 1,
      },
    });

    expect(this.querier.conn.all).toBeCalledWith(
      'SELECT `id`, (SELECT COUNT(*) `count` FROM `ItemTag` WHERE `ItemTag`.`tagId` = `id`) `itemsCount` FROM `Tag`'
    );

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFind$exists() {
    await this.querier.findMany(Item, {
      $project: {
        id: 1,
      },
      $filter: {
        $exists: raw(({ escapedPrefix, dialect }) =>
          dialect.find(
            User,
            {
              $project: ['id'],
              $filter: { companyId: raw(escapedPrefix + dialect.escapeId(`companyId`)) },
            },
            { autoPrefix: true }
          )
        ),
      },
    });

    expect(this.querier.conn.all).toBeCalledWith(
      'SELECT `id` FROM `Item` WHERE EXISTS (SELECT `User`.`id` FROM `User` WHERE `User`.`companyId` = `Item`.`companyId`)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFind$nexists() {
    await this.querier.findMany(Item, {
      $project: {
        id: 1,
      },
      $filter: {
        $nexists: raw(({ escapedPrefix, dialect }) =>
          dialect.find(
            User,
            {
              $project: ['id'],
              $filter: { companyId: raw(escapedPrefix + dialect.escapeId(`companyId`)) },
            },
            { autoPrefix: true }
          )
        ),
      },
    });

    expect(this.querier.conn.all).toBeCalledWith(
      'SELECT `id` FROM `Item` WHERE NOT EXISTS (SELECT `User`.`id` FROM `User` WHERE `User`.`companyId` = `Item`.`companyId`)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOneAndProjectOneToManyOnly() {
    await this.querier.insertMany(InventoryAdjustment, [
      {
        id: 123,
        createdAt: 1,
      },
      { id: 456, createdAt: 1 },
    ]);

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `InventoryAdjustment` (`id`, `createdAt`) VALUES (123, 1), (456, 1)');

    await this.querier.findMany(InventoryAdjustment, {
      $project: { itemAdjustments: ['id', 'buyPrice', 'itemId', 'creatorId', 'createdAt'] },
      $filter: { createdAt: 1 },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `id`, `buyPrice`, `itemId`, `creatorId`, `createdAt`, `inventoryAdjustmentId`' +
        ' FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (123, 456)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldFindOneAndProjectOneToManyWithSpecifiedFields() {
    await this.querier.insertMany(InventoryAdjustment, [
      {
        createdAt: 1,
        itemAdjustments: [{ createdAt: 1 }, { createdAt: 1 }],
      },
      {
        createdAt: 1,
        itemAdjustments: [{ createdAt: 1 }, { createdAt: 1 }],
      },
    ]);

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `InventoryAdjustment` (`createdAt`) VALUES (1), (1)');
    expect(this.querier.conn.run).nthCalledWith(2, 'INSERT INTO `ItemAdjustment` (`createdAt`, `inventoryAdjustmentId`) VALUES (1, 1), (1, 1)');
    expect(this.querier.conn.run).nthCalledWith(3, 'INSERT INTO `ItemAdjustment` (`createdAt`, `inventoryAdjustmentId`) VALUES (1, 2), (1, 2)');

    await this.querier.findMany(InventoryAdjustment, {
      $project: { id: true, itemAdjustments: ['buyPrice'] },
      $filter: { createdAt: 1 },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `buyPrice`, `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (1, 2)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(3);
  }

  async shouldFindManyAndProjectOneToMany() {
    await this.querier.insertMany(InventoryAdjustment, [
      { id: 123, description: 'something a', createdAt: 1 },
      { id: 456, description: 'something b', createdAt: 1 },
    ]);

    expect(this.querier.conn.run).nthCalledWith(
      1,
      "INSERT INTO `InventoryAdjustment` (`id`, `description`, `createdAt`) VALUES (123, 'something a', 1), (456, 'something b', 1)"
    );

    await this.querier.findMany(InventoryAdjustment, {
      $project: { id: true, itemAdjustments: true },
      $filter: { createdAt: 1 },
    });

    expect(this.querier.conn.all).nthCalledWith(
      1,
      'SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `InventoryAdjustment`.`createdAt` = 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `id`, `companyId`, `creatorId`, `createdAt`, `updatedAt`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ', `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN (123, 456)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldFindOneAndProjectManyToMany() {
    await this.querier.insertOne(Item, { id: 123, createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `Item` (`id`, `createdAt`) VALUES (123, 1)');

    await this.querier.findOne(Item, {
      $project: { id: true, createdAt: true, tags: ['id'] },
    });

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `Item`.`id`, `Item`.`createdAt` FROM `Item` LIMIT 1');
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `ItemTag`.`id`, `ItemTag`.`itemId`, `tag`.`id` `tag.id`' +
        ' FROM `ItemTag` INNER JOIN `Tag` `tag` ON `tag`.`id` = `ItemTag`.`tagId`' +
        ' WHERE `ItemTag`.`itemId` IN (123)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldFindOneByIdAndProjectManyToMany() {
    await this.querier.insertOne(Item, { id: 123, createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `Item` (`id`, `createdAt`) VALUES (123, 1)');

    await this.querier.findOneById(Item, 123, {
      $project: { id: 1, createdAt: 1, tags: ['id'] },
    });

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `Item`.`id`, `Item`.`createdAt` FROM `Item` WHERE `Item`.`id` = 123 LIMIT 1');
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT `ItemTag`.`id`, `ItemTag`.`itemId`, `tag`.`id` `tag.id`' +
        ' FROM `ItemTag` INNER JOIN `Tag` `tag` ON `tag`.`id` = `ItemTag`.`tagId`' +
        ' WHERE `ItemTag`.`itemId` IN (123)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldFindMany() {
    await this.querier.findMany(User, {
      $project: { id: true, name: true },
      $filter: { companyId: 123 },
      $limit: 100,
    });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id`, `name` FROM `User` WHERE `companyId` = 123 LIMIT 100');
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindManyAndCount() {
    await this.querier.findManyAndCount(User, {
      $project: { id: true, name: true },
      $filter: { companyId: 123 },
      $sort: { createdAt: -1 },
      $skip: 50,
      $limit: 100,
    });
    expect(this.querier.conn.all).nthCalledWith(
      1,
      'SELECT `id`, `name` FROM `User` WHERE `companyId` = 123 ORDER BY `createdAt` DESC LIMIT 100 OFFSET 50'
    );
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT COUNT(*) `count` FROM `User` WHERE `companyId` = 123');
    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { companyId: 123, createdAt: 1 });
    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `User` (`companyId`, `createdAt`) VALUES (123, 1)');
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      createdAt: 1,
      profile: { picture: 'abc', createdAt: 1 },
    });
    expect(this.querier.conn.run).nthCalledWith(1, "INSERT INTO `User` (`name`, `createdAt`) VALUES ('some name', 1)");
    expect(this.querier.conn.run).nthCalledWith(2, "INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`) VALUES ('abc', 1, 1)");
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(2);
  }

  async shouldInsertOneAndCascadeManyToOne() {
    await this.querier.insertOne(MeasureUnit, {
      name: 'Centimeter',
      createdAt: 123,
      category: { name: 'Metric', createdAt: 123 },
    });

    expect(this.querier.conn.run).nthCalledWith(1, "INSERT INTO `MeasureUnit` (`name`, `createdAt`) VALUES ('Centimeter', 123)");
    expect(this.querier.conn.run).nthCalledWith(2, "INSERT INTO `MeasureUnitCategory` (`name`, `createdAt`) VALUES ('Metric', 123)");
    expect(this.querier.conn.run).nthCalledWith(
      3,
      expect.toMatch(/^UPDATE `MeasureUnit` SET `categoryId` = 1, `updatedAt` = \d+ WHERE `id` = 1 AND `deletedAt` IS NULL$/)
    );
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(3);
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
    expect(this.querier.conn.run).nthCalledWith(1, "INSERT INTO `InventoryAdjustment` (`description`, `createdAt`) VALUES ('some description', 1)");
    expect(this.querier.conn.run).nthCalledWith(
      2,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (50, 1, 1), (300, 1, 1)'
    );
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(2);
  }

  async shouldUpdateMany() {
    await this.querier.updateMany(User, { $filter: { companyId: 4 } }, { name: 'Hola', updatedAt: 1 });
    expect(this.querier.conn.run).nthCalledWith(1, "UPDATE `User` SET `name` = 'Hola', `updatedAt` = 1 WHERE `companyId` = 4");
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, 5, { companyId: 123, updatedAt: 1 });
    expect(this.querier.conn.run).nthCalledWith(1, 'UPDATE `User` SET `companyId` = 123, `updatedAt` = 1 WHERE `id` = 5');
    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    await this.querier.insertOne(User, { createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (1)');

    await this.querier.updateOneById(User, 1, {
      name: 'something',
      updatedAt: 1,
      profile: { picture: 'xyz', createdAt: 1 },
    });

    expect(this.querier.conn.run).nthCalledWith(2, "UPDATE `User` SET `name` = 'something', `updatedAt` = 1 WHERE `id` = 1");
    expect(this.querier.conn.run).nthCalledWith(3, "INSERT INTO `user_profile` (`image`, `createdAt`, `creatorId`) VALUES ('xyz', 1, 1)");

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = 1');

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(3);
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    await this.querier.insertOne(User, { createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (1)');

    await this.querier.updateOneById(User, 1, {
      name: 'something',
      updatedAt: 1,
      profile: null,
    });

    expect(this.querier.conn.run).nthCalledWith(2, "UPDATE `User` SET `name` = 'something', `updatedAt` = 1 WHERE `id` = 1");
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `pk` `id` FROM `user_profile` WHERE `creatorId` = 1');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(2);
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    await this.querier.insertOne(InventoryAdjustment, { createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `InventoryAdjustment` (`createdAt`) VALUES (1)');

    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      updatedAt: 1,
      itemAdjustments: [
        { buyPrice: 50, createdAt: 1 },
        { buyPrice: 300, createdAt: 1 },
      ],
    });

    expect(this.querier.conn.run).nthCalledWith(
      2,
      "UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `id` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,
      'INSERT INTO `ItemAdjustment` (`buyPrice`, `createdAt`, `inventoryAdjustmentId`) VALUES (50, 1, 1), (300, 1, 1)'
    );

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(3);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `InventoryAdjustment` (`createdAt`) VALUES (1)');

    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      updatedAt: 1,
      itemAdjustments: null,
    });

    expect(this.querier.conn.run).nthCalledWith(
      2,
      "UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = 1 WHERE `id` = 1"
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `id` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `id` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(2);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { companyId: 1, createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `InventoryAdjustment` (`companyId`, `createdAt`) VALUES (1, 1)');

    await this.querier.updateMany(
      InventoryAdjustment,
      { $filter: { companyId: 1 } },
      {
        description: 'some description',
        updatedAt: 1,
        itemAdjustments: null,
      }
    );

    expect(this.querier.conn.run).nthCalledWith(
      2,
      "UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = 1 WHERE `companyId` = 1"
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `InventoryAdjustment` WHERE `companyId` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `id` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(2);
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
    expect(this.querier.conn.run).nthCalledWith(2, "INSERT INTO `Tag` (`name`, `createdAt`) VALUES ('tag one', 1), ('tag two', 1)");
    expect(this.querier.conn.run).nthCalledWith(3, 'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (1, 1), (1, 2)');

    expect(this.querier.conn.all).toBeCalledTimes(0);
    expect(this.querier.conn.run).toBeCalledTimes(3);
  }

  async shouldUpdateAndCascadeManyToManyInserts() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `Item` (`createdAt`) VALUES (1)');

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

    expect(this.querier.conn.run).nthCalledWith(2, "UPDATE `Item` SET `name` = 'item one', `updatedAt` = 1 WHERE `id` = 1");
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = 1');
    expect(this.querier.conn.run).nthCalledWith(3, "INSERT INTO `Tag` (`name`, `createdAt`) VALUES ('tag one', 1), ('tag two', 1)");

    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `id` FROM `ItemTag` WHERE `itemId` = 1');
    expect(this.querier.conn.run).nthCalledWith(4, 'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (1, 1), (1, 2)');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(4);
  }

  async shouldUpdateAndCascadeManyToManyLinks() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `Item` (`createdAt`) VALUES (1)');

    await this.querier.updateOneById(Item, id, {
      name: 'item one',
      tags: [{ id: 22 }, { id: 33 }],
      updatedAt: 1,
    });

    expect(this.querier.conn.run).nthCalledWith(2, "UPDATE `Item` SET `name` = 'item one', `updatedAt` = 1 WHERE `id` = 1");
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `id` FROM `ItemTag` WHERE `itemId` = 1');
    expect(this.querier.conn.run).nthCalledWith(3, 'INSERT INTO `ItemTag` (`itemId`, `tagId`) VALUES (1, 22), (1, 33)');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(3);
  }

  async shouldDeleteOneAndCascadeManyToManyDeletes() {
    await this.shouldInsertOneAndCascadeManyToManyInserts();

    jest.clearAllMocks();

    await this.querier.deleteOneById(Item, 1);

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `Item` WHERE `id` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `id` FROM `ItemTag` WHERE `itemId` IN (1)');
    expect(this.querier.conn.run).nthCalledWith(1, 'DELETE FROM `Item` WHERE `id` IN (1)');
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `ItemTag` WHERE `id` IN (1, 2)');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(2);
  }

  async shouldDeleteOneAndNoCascadeManyToManyDeletes() {
    await this.shouldInsertOneAndCascadeManyToManyInserts();

    jest.clearAllMocks();

    await this.querier.deleteOneById(Tag, 1);

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `Tag` WHERE `id` = 1');
    expect(this.querier.conn.run).nthCalledWith(1, 'DELETE FROM `Tag` WHERE `id` IN (1)');

    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(1);
  }

  async shouldDeleteOneById() {
    const id = await this.querier.insertOne(User, { createdAt: 1, profile: { createdAt: 1 } });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (1)');
    expect(this.querier.conn.run).nthCalledWith(2, 'INSERT INTO `user_profile` (`createdAt`, `creatorId`) VALUES (1, 1)');

    await this.querier.deleteOneById(User, id);

    expect(this.querier.conn.run).nthCalledWith(3, 'DELETE FROM `User` WHERE `id` IN (1)');
    expect(this.querier.conn.run).nthCalledWith(4, 'DELETE FROM `user_profile` WHERE `pk` IN (1)');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `User` WHERE `id` = 1');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `pk` `id` FROM `user_profile`');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(4);
  }

  async shouldDeleteMany() {
    await this.querier.insertOne(User, { createdAt: 123 });

    expect(this.querier.conn.run).nthCalledWith(1, 'INSERT INTO `User` (`createdAt`) VALUES (123)');

    await this.querier.deleteMany(User, { $filter: { createdAt: 123 } });

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT `id` FROM `User` WHERE `createdAt` = 123');
    expect(this.querier.conn.all).nthCalledWith(2, 'SELECT `pk` `id` FROM `user_profile`');
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM `User` WHERE `id` IN (1)');

    expect(this.querier.conn.all).toBeCalledTimes(2);
    expect(this.querier.conn.run).toBeCalledTimes(2);
  }

  async shouldCount() {
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
    await this.querier.updateOneById(User, 5, { name: 'Hola' });
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
    await this.querier.rollbackTransaction();
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
    await this.querier.updateOneById(User, 5, { name: 'some name' });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(0);
    await this.querier.rollbackTransaction();
  }
}
