import { User, InventoryAdjustment, Spec, Item, normalizeSql, Tag } from '../test';
import { QuerierPoolConnection } from '../type';
import { BaseSqlQuerier } from './baseSqlQuerier';

export class BaseSqlQuerierSpec implements Spec {
  normalize: (sql: string) => string;
  querier: BaseSqlQuerier;

  constructor(private readonly querierConstructor: new (conn: QuerierPoolConnection) => BaseSqlQuerier) {}

  beforeEach() {
    this.normalize = (sql) => normalizeSql(sql, this.querier.dialect.escapeIdChar);
    this.querier = new this.querierConstructor({
      all: jest.fn(() => Promise.resolve([])),
      run: jest.fn(() => Promise.resolve({ changes: 1, lastId: 1 })),
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
      'SELECT id, companyId, creatorId, createdAt, updatedAt, name, email, password FROM User WHERE id = 1 LIMIT 1'
    );
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldFindOne() {
    await this.querier.findOne(User, { $filter: { companyId: 123 }, $project: ['id', 'name'] });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id, name FROM User WHERE companyId = 123 LIMIT 1');
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
      'SELECT InventoryAdjustment.id FROM InventoryAdjustment WHERE InventoryAdjustment.creatorId = 1 LIMIT 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT id, companyId, creatorId, createdAt, updatedAt, itemId, number, buyPrice, storehouseId' +
        ', inventoryAdjustmentId FROM ItemAdjustment WHERE inventoryAdjustmentId IN (123, 456)'
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
      'SELECT InventoryAdjustment.id FROM InventoryAdjustment WHERE InventoryAdjustment.creatorId = 1 LIMIT 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT buyPrice, inventoryAdjustmentId FROM ItemAdjustment WHERE inventoryAdjustmentId IN (123, 456)'
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
      'SELECT InventoryAdjustment.id FROM InventoryAdjustment WHERE InventoryAdjustment.creatorId = 1'
    );
    expect(this.querier.conn.all).nthCalledWith(
      2,
      'SELECT id, companyId, creatorId, createdAt, updatedAt, itemId, number, buyPrice, storehouseId' +
        ', inventoryAdjustmentId FROM ItemAdjustment WHERE inventoryAdjustmentId IN (123, 456)'
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

    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT Item.id, Item.name FROM Item LIMIT 1');
    expect(this.querier.conn.all).nthCalledWith(
      2,
      this.normalize(
        'SELECT ItemTag.itemId, tag.id `tag.id`' +
          ' FROM ItemTag INNER JOIN Tag tag ON tag.id = ItemTag.tagId' +
          ' WHERE ItemTag.itemId IN (123)'
      )
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
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id, name FROM User WHERE companyId = 123 LIMIT 100');
    expect(this.querier.conn.all).toBeCalledTimes(1);
    expect(this.querier.conn.run).toBeCalledTimes(0);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { companyId: 123, createdAt: 1 });
    expect(this.querier.conn.run).nthCalledWith(
      1,
      this.normalize('INSERT INTO User (companyId, createdAt) VALUES (123, 1)')
    );
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      profile: { picture: 'abc' },
    });
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^INSERT INTO User \(name, createdAt\) VALUES \('some name', \d+\)(?: RETURNING id id)?$/)
    );
    expect(this.querier.conn.run).nthCalledWith(
      2,
      expect.toMatch(
        /^INSERT INTO user_profile \(image, creatorId, createdAt\) VALUES \('abc', 1, \d+\)(?: RETURNING pk id)?$/
      )
    );
    expect(this.querier.conn.run).toBeCalledTimes(2);
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
      expect.toMatch(
        /^INSERT INTO InventoryAdjustment \(description, createdAt\) VALUES \('some description', 1\)(?: RETURNING id id)?$/
      )
    );
    expect(this.querier.conn.run).nthCalledWith(
      2,
      expect.toMatch(
        /^INSERT INTO ItemAdjustment \(buyPrice, createdAt, inventoryAdjustmentId\) VALUES \(50, 1, 1\), \(300, 1, 1\)(?: RETURNING id id)?$/
      )
    );
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateMany() {
    await this.querier.updateMany(User, { name: 'Hola' }, { $filter: { id: 5 } });
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, { companyId: 123, updatedAt: 1 }, 5);
    expect(this.querier.conn.run).nthCalledWith(1, `UPDATE User SET companyId = 123, updatedAt = 1 WHERE id = 5`);
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      User,
      {
        name: 'something',
        profile: { picture: 'xyz' },
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE User SET name = 'something', updatedAt = \d+ WHERE id = 1$/)
    );
    expect(this.querier.conn.run).nthCalledWith(
      2,
      expect.toMatch(
        /^INSERT INTO user_profile \(image, creatorId, createdAt\) VALUES \('xyz', 1, \d+\)(?: RETURNING pk id)?$/
      )
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id FROM User WHERE id = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      User,
      {
        name: 'something',
        profile: null,
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE User SET name = 'something', updatedAt = \d+ WHERE id = 1$/)
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM user_profile WHERE creatorId = 1');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id FROM User WHERE id = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      InventoryAdjustment,
      {
        description: 'some description',
        itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE InventoryAdjustment SET description = 'some description', updatedAt = \d+ WHERE id = 1$/)
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM ItemAdjustment WHERE inventoryAdjustmentId = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,
      expect.toMatch(
        /^INSERT INTO ItemAdjustment \(buyPrice, inventoryAdjustmentId, createdAt\) VALUES \(50, 1, \d+\), \(300, 1, \d+\)(?: RETURNING id id)?$/
      )
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id FROM InventoryAdjustment WHERE id = 1');
    expect(this.querier.conn.run).toBeCalledTimes(3);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateOneById(
      InventoryAdjustment,
      {
        description: 'some description',
        itemAdjustments: null,
      },
      1
    );

    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE InventoryAdjustment SET description = 'some description', updatedAt = \d+ WHERE id = 1$/)
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM ItemAdjustment WHERE inventoryAdjustmentId = 1');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id FROM InventoryAdjustment WHERE id = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ id: 1 }]);

    await this.querier.updateMany(
      InventoryAdjustment,
      {
        description: 'some description',
        itemAdjustments: null,
      },
      { $filter: { companyId: 1 } }
    );

    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(
        /^UPDATE InventoryAdjustment SET description = 'some description', updatedAt = \d+ WHERE companyId = 1$/
      )
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM ItemAdjustment WHERE inventoryAdjustmentId = 1');
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id FROM InventoryAdjustment WHERE companyId = 1');
    expect(this.querier.conn.run).toBeCalledTimes(2);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldInsertOneAndCascadeManyToManyInserts() {
    await this.querier.insertOne(Item, {
      name: 'item one',
      tags: [
        {
          name: 'tag one',
        },
        {
          name: 'tag two',
        },
      ],
    });
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^INSERT INTO Item \(name, createdAt\) VALUES \('item one', \d+\)(?: RETURNING id id)?$/)
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM ItemTag WHERE itemId = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,
      expect.toMatch(
        /^INSERT INTO Tag \(name, createdAt\) VALUES \('tag one', \d+\), \('tag two', \d+\)(?: RETURNING id id)?$/
      )
    );
    expect(this.querier.conn.run).nthCalledWith(
      4,
      expect.toMatch(/^INSERT INTO ItemTag \(itemId, tagId\) VALUES \(\d+, \d+\), \(\d+, \d+\)(?: RETURNING id id)?$/)
    );
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
        tags: [
          {
            name: 'tag one',
          },
          {
            name: 'tag two',
          },
        ],
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE Item SET name = 'item one', updatedAt = \d+ WHERE id = 1(?: RETURNING id id)?$/)
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM ItemTag WHERE itemId = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,
      expect.toMatch(
        /^INSERT INTO Tag \(name, createdAt\) VALUES \('tag one', \d+\), \('tag two', \d+\)(?: RETURNING id id)?$/
      )
    );
    expect(this.querier.conn.run).nthCalledWith(
      4,
      expect.toMatch(/^INSERT INTO ItemTag \(itemId, tagId\) VALUES \(1, \d+\), \(1, \d+\)(?: RETURNING id id)?$/)
    );
    expect(this.querier.conn.run).toBeCalledTimes(4);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldUpdateAndCascadeManyToManyLinks() {
    const mockItem: Item[] = [{ id: 1 }];
    const mockTags: Tag[] = [{ id: 22 }, { id: 33 }];

    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce(mockItem);
    jest
      .spyOn(this.querier.conn, 'run')
      .mockResolvedValueOnce({ changes: 2, lastId: Number(mockTags[mockTags.length - 1].id) });

    await this.querier.updateOneById(
      Item,
      {
        name: 'item one',
        tags: mockTags,
      },
      1
    );
    expect(this.querier.conn.run).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE Item SET name = 'item one', updatedAt = \d+ WHERE id = 1(?: RETURNING id id)?$/)
    );
    expect(this.querier.conn.run).nthCalledWith(2, 'DELETE FROM ItemTag WHERE itemId = 1');
    expect(this.querier.conn.run).nthCalledWith(
      3,
      this.normalize('INSERT INTO ItemTag (itemId, tagId) VALUES (1, 22), (1, 33)')
    );
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT id FROM Item WHERE id = 1');
    expect(this.querier.conn.run).toBeCalledTimes(3);
    expect(this.querier.conn.all).toBeCalledTimes(1);
  }

  async shouldDeleteOneById() {
    await expect(this.querier.deleteOneById(User, 5));
    expect(this.querier.conn.run).nthCalledWith(1, 'DELETE FROM User WHERE id = 5');
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldDeleteMany() {
    await this.querier.deleteMany(User, { $filter: { companyId: 123 } });
    expect(this.querier.conn.run).nthCalledWith(1, 'DELETE FROM User WHERE companyId = 123');
    expect(this.querier.conn.run).toBeCalledTimes(1);
    expect(this.querier.conn.all).toBeCalledTimes(0);
  }

  async shouldCount() {
    jest.spyOn(this.querier.conn, 'all').mockResolvedValueOnce([{ count: 1 }]);
    await this.querier.count(User, { $filter: { companyId: 123 } });
    expect(this.querier.conn.all).nthCalledWith(1, 'SELECT COUNT(*) count FROM User WHERE companyId = 123');
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
