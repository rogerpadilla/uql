import {
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  LedgerAccount,
  Profile,
  Spec,
  Tax,
  TaxCategory,
  User,
} from '../test';
import { Querier, QuerierPool } from '../type';

export abstract class BaseQuerierIt<Q extends Querier> implements Spec {
  readonly entities = [
    InventoryAdjustment,
    ItemAdjustment,
    Item,
    Tax,
    TaxCategory,
    LedgerAccount,
    Profile,
    Company,
    User,
  ] as const;

  querier: Q;

  constructor(readonly pool: QuerierPool) {}

  async beforeAll() {
    this.querier = (await this.pool.getQuerier()) as Q;
    await this.dropTables();
    await this.createTables();
    await this.querier.release();
  }

  async beforeEach() {
    this.querier = (await this.pool.getQuerier()) as Q;
    await this.cleanTables();
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
    ids.forEach((id) => expect(id).toBeDefined());
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
    ids.forEach((id) => expect(id).toBeDefined());
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
    ids.forEach((id) => expect(id).toBeDefined());
    const founds = await this.querier.findMany(LedgerAccount, {});
    expect(founds.map(({ id }) => id)).toEqual(ids);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    // setDebug(true);
    const payload: User = {
      name: 'Some Name D',
      profile: { picture: 'abc', createdAt: 123 },
      createdAt: 123,
    };

    const id = await this.querier.insertOne(User, payload);

    expect(id).toBeDefined();

    const user = await this.querier.findOneById(User, id, { $populate: { profile: {} } });

    expect(user).toMatchObject(payload);
  }

  async shouldInsertOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments,
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      description: 'some description',
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $filter: { inventoryAdjustmentId } });

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
      $populate: { itemAdjustments: { $project: ['buyPrice'] } },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      description: 'some description',
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const changes = await this.querier.updateOneById(
      InventoryAdjustment,
      {
        itemAdjustments,
      },
      inventoryAdjustmentId
    );

    expect(changes).toBe(1);

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      description: 'some description',
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    const id = await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment)).resolves.toBe(2);

    await this.querier.updateOneById(
      InventoryAdjustment,
      {
        itemAdjustments: null,
      },
      id
    );

    await expect(this.querier.count(ItemAdjustment)).resolves.toBe(0);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment)).resolves.toBe(2);

    await this.querier.updateMany(
      InventoryAdjustment,
      {
        itemAdjustments: null,
      },
      {}
    );

    await expect(this.querier.count(ItemAdjustment)).resolves.toBe(0);
  }

  async shouldInsertOneAndCascadeManyToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments,
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      description: 'some description',
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneAndCascadeManyToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const changes = await this.querier.updateOneById(
      InventoryAdjustment,
      {
        itemAdjustments,
      },
      inventoryAdjustmentId
    );

    expect(changes).toBe(1);

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      description: 'some description',
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldFindMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const users = await this.querier.findMany(User, {
      $project: ['name'],
      $skip: 1,
      $limit: 2,
      $sort: {
        name: 1,
      },
    });

    expect(users).toMatchObject([
      {
        name: 'Some Name B',
      },
      {
        name: 'Some Name C',
      },
    ]);
  }

  async shouldFindOne() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const found = await this.querier.findOne(User, {
      $project: {
        id: 1,
        name: 1,
        email: 1,
        password: 1,
      },
      $filter: {
        email: 'someemaila@example.com',
      },
    });

    expect(found).toMatchObject({
      name: 'Some Name A',
      email: 'someemaila@example.com',
      password: '123456789a!',
    });

    const notFound = await this.querier.findOne(User, {
      $filter: {
        name: 'some name',
      },
    });

    expect(notFound).toBeUndefined();
  }

  async shouldCount() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.count(User)).resolves.toBe(3);
    await expect(this.querier.count(User, { $filter: { companyId: null } })).resolves.toBe(3);
    await expect(this.querier.count(User, { $filter: { companyId: 1 } })).resolves.toBe(0);
  }

  async shouldUpdateMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.updateMany(User, { companyId: null }, { $filter: { companyId: 1 } })).resolves.toBe(0);
    await expect(this.querier.updateMany(User, { companyId: 1 }, { $filter: { companyId: null } })).resolves.toBe(3);
    await expect(this.querier.updateMany(User, { companyId: null }, { $filter: { companyId: 1 } })).resolves.toBe(3);
  }

  async shouldThrowWhenRollbackTransactionWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldThrowIfUnknownComparisonOperator() {
    await expect(
      this.querier.findMany(User, {
        $filter: { name: { $someInvalidOperator: 'some' } as any },
      })
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  async shouldRollback() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const count1 = await this.querier.count(User);
    await expect(this.querier.count(User)).resolves.toBe(3);

    await this.querier.beginTransaction();
    await expect(this.querier.count(User)).resolves.toBe(count1);
    await expect(this.querier.deleteMany(User, { $filter: { companyId: null } })).resolves.toBe(count1);
    await expect(this.querier.count(User)).resolves.toBe(0);
    await this.querier.rollbackTransaction();
    await expect(this.querier.count(User)).resolves.toBe(count1);
  }

  async shouldThrowWhenBeginTransactionAfterBeginTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    await this.querier.rollbackTransaction();
  }

  async shouldPopulateOneToMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const [user, company] = await Promise.all([
      this.querier.findOne(User, { $project: { id: 1 } }),
      this.querier.findOne(Company, { $project: { id: 1 } }),
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
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
      creatorId: user.id,
      companyId: company.id,
    });

    const inventoryAdjustment = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: {}, creator: {} },
    });

    expect(inventoryAdjustment).toMatchObject({
      description: 'some inventory adjustment',
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
      creator: {
        email: 'someemaila@example.com',
        name: 'Some Name A',
        password: '123456789a!',
      },
    });
  }

  async shouldDeleteMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);
    await expect(this.querier.deleteMany(User, { $filter: { companyId: 1 } })).resolves.toBe(0);
    await expect(this.querier.deleteMany(User, { $filter: { companyId: null } })).resolves.toBe(3);
  }

  async shouldThrowWhenCommitTransactionWithoutBeginTransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  }

  async cleanTables() {
    await Promise.all(this.entities.map((entity) => this.querier.deleteMany(entity, {})));
  }

  abstract createTables(): Promise<void>;

  abstract dropTables(): Promise<void>;
}
