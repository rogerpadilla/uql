import { getEntities } from '../entity/index.js';
import {
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  LedgerAccount,
  MeasureUnit,
  type Spec,
  Tag,
  TaxCategory,
  User,
} from '../test/index.js';
import type { Querier, QuerierPool } from '../type/index.js';

export abstract class AbstractQuerierIt<Q extends Querier> implements Spec {
  querier: Q;

  constructor(protected pool: QuerierPool<Q>) {}

  async beforeAll() {
    const querier = await this.pool.getQuerier();
    try {
      this.querier = querier;
      await this.dropTables();
      await this.createTables();
    } finally {
      await querier.release();
      this.querier = undefined;
    }
  }

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
    await this.clearTables();
  }

  async afterEach() {
    await this.querier.release();
  }

  async afterAll() {
    await this.pool.end();
  }

  shouldGetRepository() {
    const repository = this.querier.getRepository(User);
    expect(repository).toBeDefined();
  }

  async shouldInsertMany() {
    const ids = await this.querier.insertMany(User, [
      {
        name: 'Some Name A',
        email: 'someemaila@example.com',
        password: '123456789a!',
      },
      {
        name: 'Some Name B',
        email: 'someemailb@example.com',
        password: '123456789b!',
      },
    ]);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
  }

  async shouldInsertManyEmpty() {
    const ids = await this.querier.insertMany(User, []);
    expect(ids).toEqual([]);
  }

  async shouldInsertOne() {
    const creatorId = await this.querier.insertOne(User, {
      name: 'Some Name C',
      email: 'someemailc@example.com',
      password: '123456789z!',
    });
    expect(creatorId).toBeDefined();

    const companyId = await this.querier.insertOne(Company, {
      name: 'Some Name C',
      creatorId,
    });
    expect(companyId).toBeDefined();

    const taxCategoryId = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name C',
      description: 'Some Description Z',
      creatorId,
      companyId,
    });
    expect(taxCategoryId).toBeDefined();
  }

  async shouldInsertOneWithOnInsertId() {
    const id1 = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name',
    });
    const id2 = await this.querier.insertOne(TaxCategory, {
      pk: '123',
      name: 'Some Name',
    });
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
  }

  async shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const ids = await this.querier.insertMany(TaxCategory, [
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
    ]);
    expect(ids).toHaveLength(4);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
  }

  async shouldInsertManyWithAutoIncrementIdAsDefault() {
    const ids = await this.querier.insertMany(LedgerAccount, [
      {
        name: 'Some Name A',
      },
      {
        name: 'Some Name B',
      },
      {
        name: 'Some Name C',
      },
    ]);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
    const founds = await this.querier.findMany(LedgerAccount, {});
    expect(founds.map(({ id }) => id)).toEqual(ids);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    const payload = {
      name: 'Some Name D',
      createdAt: 123,
      profile: { picture: 'abc', createdAt: 123 },
    } satisfies User;
    const id = await this.querier.insertOne(User, payload);
    expect(id).toBeDefined();
    const found = await this.querier.findOneById(User, id, { $select: { profile: true } });
    expect(found).toMatchObject({ id, profile: payload.profile });
  }

  async shouldInsertOneAndCascadeManyToOne() {
    const payload = {
      name: 'Centimeter',
      createdAt: 123,
      category: { name: 'Metric', createdAt: 123 },
    } satisfies MeasureUnit;

    const id = await this.querier.insertOne(MeasureUnit, payload);

    expect(id).toBeDefined();

    const found = await this.querier.findOneById(MeasureUnit, id, { $select: { category: true } });

    expect(found).toMatchObject({ id, category: payload.category });
  }

  async shouldInsertSpecialChars() {
    const payload: MeasureUnit = {
      name: `I'm Cielo! How are you doing today? It's been a while since we last talked`,
      createdAt: 123,
    };

    const id = await this.querier.insertOne(MeasureUnit, payload);

    expect(id).toBeDefined();

    const found = await this.querier.findOneById(MeasureUnit, id);

    expect(found).toMatchObject(payload);
  }

  async shouldInsertOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const date = new Date();

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      date,
      itemAdjustments,
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $select: { itemAdjustments: true },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldInsertOneAndCascadeOneToManyWithSpecificFields() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: itemAdjustments.slice(),
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $select: { itemAdjustments: ['buyPrice'] },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const changes = await this.querier.updateOneById(InventoryAdjustment, inventoryAdjustmentId, {
      itemAdjustments,
    });

    expect(changes).toBe(1);

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $select: { itemAdjustments: ['buyPrice'] },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    const id = await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(2);

    await this.querier.updateOneById(InventoryAdjustment, id, {
      itemAdjustments: null,
    });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(0);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(2);

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: {} },
      {
        itemAdjustments: null,
      },
    );

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(0);
  }

  async shouldInsertOneAndCascadeManyToMany() {
    const payload: Item = {
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
    };

    const id = await this.querier.insertOne(Item, payload);

    expect(id).toBeDefined();

    const foundItem = await this.querier.findOneById(Item, id, {
      $select: { name: true, createdAt: true, tags: ['name', 'createdAt'] },
    });

    expect(foundItem).toMatchObject({
      id,
      ...payload,
    });

    const foundTags = await this.querier.findMany(Tag, {
      $select: { name: true, createdAt: true, items: ['name', 'createdAt'] },
    });

    delete foundItem.tags;

    expect(foundTags).toMatchObject(payload.tags.map((tag) => ({ ...tag, items: [foundItem] })));
  }

  async shouldUpdateOneAndCascadeManyToMany() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });
    const payload: Item = {
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
    };

    await this.querier.updateOneById(Item, id, payload);

    const found = await this.querier.findOneById(Item, id, {
      $select: { name: true, updatedAt: true, tags: true },
    });

    expect(found).toMatchObject({
      id,
      ...payload,
    });
  }

  async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';
    const record1 = await this.querier.findOne(TaxCategory, {
      $select: ['name'],
      $where: { pk },
    });
    expect(record1).toBeUndefined();
    await this.querier.upsertOne(
      TaxCategory,
      { pk: true },
      {
        pk,
        name: 'Some Name C',
      },
    );
    const record2 = await this.querier.findOne(TaxCategory, {
      $select: ['name'],
      $where: { pk },
    });
    expect(record2).toMatchObject({
      name: 'Some Name C',
    });
    await this.querier.upsertOne(
      TaxCategory,
      { pk: true },
      {
        pk,
        name: 'Some Name D',
      },
    );
    const record3 = await this.querier.findOne(TaxCategory, {
      $select: ['name'],
      $where: { pk },
    });
    expect(record3).toMatchObject({
      name: 'Some Name D',
    });
  }

  async shouldFindOne() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const found = await this.querier.findOne(User, {
      $select: ['id', 'name', 'email', 'password'],
      $where: {
        email: 'someemaila@example.com',
      },
    });

    expect(found).toMatchObject({
      name: 'Some Name A',
      email: 'someemaila@example.com',
      password: '123456789a!',
    });

    const notFound = await this.querier.findOne(User, {
      $where: {
        name: 'some name',
      },
    });

    expect(notFound).toBeUndefined();
  }

  async shouldCount() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.count(User, {})).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: null } })).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: 1 } })).resolves.toBe(0);
  }

  async shouldUpdateMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.updateMany(User, { $where: { companyId: 1 } }, { companyId: null })).resolves.toBe(0);
    await expect(this.querier.updateMany(User, { $where: { companyId: null } }, { companyId: 1 })).resolves.toBe(3);
    await expect(this.querier.updateMany(User, { $where: { companyId: 1 } }, { companyId: null })).resolves.toBe(3);
  }

  async shouldThrowIfUnknownComparisonOperator() {
    await expect(
      this.querier.findMany(User, {
        $where: { name: { $someInvalidOperator: 'some' } as any },
      }),
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  async shouldThrowWhenRollbackTransactionWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldCommit() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.beginTransaction();
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.commitTransaction();
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.release();
  }

  async shouldRollback() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.beginTransaction();
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.rollbackTransaction();
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.release();
  }

  async shouldThrowWhenBeginTransactionAfterBeginTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    await this.querier.rollbackTransaction();
    await this.querier.release();
  }

  async shouldReturnTransactionValue() {
    const affectedRows = await this.querier.transaction(async () => {
      await this.shouldInsertMany();
      const count = await this.querier.count(User, {});
      await this.querier.deleteMany(User, {});
      return count;
    });
    expect(affectedRows).toBe(2);
  }

  async shouldThrowWhenCommitTransactionWithoutBeginTransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldSelectOneToManyEmpty() {
    const inventoryAdjustment = await this.querier.findOneById(InventoryAdjustment, -1, {
      $select: { itemAdjustments: true, creator: true },
    });
    expect(inventoryAdjustment).toBeUndefined();

    const inventoryAdjustments = await this.querier.findMany(InventoryAdjustment, {
      $select: { itemAdjustments: true },
    });
    expect(inventoryAdjustments).toHaveLength(0);
  }

  async shouldSelectOneToMany() {
    await this.shouldInsertOne();

    const [user, company] = await Promise.all([
      this.querier.findOne(User, { $select: ['id'] }),
      this.querier.findOne(Company, { $select: ['id'] }),
    ]);

    const [firstItemId, secondItemId] = await this.querier.insertMany(Item, [
      {
        name: 'some item name a',
        creatorId: user.id,
        companyId: company.id,
      },
      {
        name: 'some item name b',
        creatorId: user.id,
        companyId: company.id,
      },
    ]);

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some inventory adjustment',
      creatorId: user.id,
      companyId: company.id,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
    });

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $select: { itemAdjustments: true, creator: true },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
      creator: {
        email: 'someemailc@example.com',
        name: 'Some Name C',
      },
    });
  }

  async shouldDeleteMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);
    await expect(this.querier.deleteMany(User, { $where: { companyId: 1 } })).resolves.toBe(0);
    await expect(this.querier.deleteMany(User, { $where: { companyId: null } })).resolves.toBe(3);
  }

  async clearTables() {
    const entities = getEntities();
    await Promise.all(entities.map((entity) => this.querier.deleteMany(entity, {})));
  }

  abstract createTables(): Promise<void>;

  abstract dropTables(): Promise<void>;
}
