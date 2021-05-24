import { Company, InventoryAdjustment, Item, ItemAdjustment, Profile, Spec, Tax, TaxCategory, User } from '../test';
import { Querier, QuerierPool } from '../type';

export abstract class BaseQuerierIt implements Spec {
  readonly entities = [InventoryAdjustment, ItemAdjustment, Item, Tax, TaxCategory, Profile, Company, User] as const;
  querier: Querier;

  constructor(readonly pool: QuerierPool) {}

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
    await this.createTables();
  }

  async afterEach() {
    await this.dropTables();
    await this.querier.release();
  }

  async afterAll() {
    await this.pool.end();
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

  async shouldInsertOne() {
    const userId = await this.querier.insertOne(User, {
      name: 'Some Name C',
      email: 'someemailc@example.com',
      password: '123456789z!',
    });
    expect(userId).toBeDefined();

    const companyId = await this.querier.insertOne(Company, {
      name: 'Some Name C',
      userId,
    });
    expect(companyId).toBeDefined();

    const taxCategoryId = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name C',
      description: 'Some Description Z',
      userId,
      companyId,
    });
    expect(taxCategoryId).toBeDefined();
  }

  async shouldInsertOneAndCascadeOneToOne() {
    const body: User = {
      name: 'Some Name D',
      profile: { picture: 'abc', createdAt: 123 },
      createdAt: 123,
    };

    const id = await this.querier.insertOne(User, body);

    const profiles = await this.querier.findMany(Profile, {});

    console.log('***** profiles', profiles);

    expect(id).toBeDefined();

    const user = await this.querier.findOneById(User, id, { populate: { profile: {} } });

    expect(user).toMatchObject(body);
  }

  async shouldInsertOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments,
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findMany(InventoryAdjustment, {
      populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject([
      {
        description: 'some description',
        itemAdjustments,
      },
    ]);

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldInsertOneAndCascadeManyToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments,
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findMany(InventoryAdjustment, {
      populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject([
      {
        description: 'some description',
        itemAdjustments,
      },
    ]);

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneAndCascadeManyToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const affectedRows = await this.querier.updateOneById(InventoryAdjustment, inventoryAdjustmentId, {
      itemAdjustments,
    });

    expect(affectedRows).toBe(1);

    const inventoryAdjustmentFound = await this.querier.findMany(InventoryAdjustment, {
      populate: { itemAdjustments: {} },
    });

    expect(inventoryAdjustmentFound).toMatchObject([
      {
        description: 'some description',
        itemAdjustments,
      },
    ]);

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { filter: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldFindMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const users = await this.querier.findMany(User, {
      project: { name: 1 },
      skip: 1,
      limit: 2,
      sort: {
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
      project: {
        id: 1,
        name: 1,
        email: 1,
        password: 1,
      },
      filter: {
        email: 'someemaila@example.com',
        status: null,
      },
    });
    expect(found).toMatchObject({
      name: 'Some Name A',
      email: 'someemaila@example.com',
      password: '123456789a!',
    });

    const notFound = await this.querier.findOne(User, {
      filter: {
        status: 999,
      },
    });
    expect(notFound).toBeUndefined();
  }

  async shouldCount() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const count1 = await this.querier.count(User);
    expect(count1).toBe(3);
    const count2 = await this.querier.count(User, { status: null });
    expect(count2).toBe(3);
    const count3 = await this.querier.count(User, { status: 1 });
    expect(count3).toBe(0);
    const count4 = await this.querier.count(User, { name: { $startsWith: 'Some Name ' } });
    expect(count4).toBe(3);
  }

  async shouldUpdateMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const updatedRows1 = await this.querier.updateMany(User, { status: 1 }, { status: null });
    expect(updatedRows1).toBe(0);
    const updatedRows2 = await this.querier.updateMany(User, { status: null }, { status: 1 });
    expect(updatedRows2).toBe(3);
    const updatedRows3 = await this.querier.updateMany(User, { status: 1 }, { status: null });
    expect(updatedRows3).toBe(3);
  }

  async shouldThrowWhenRollbackTransactionWithoutBeginTransaction() {
    await expect(async () => {
      await this.querier.rollbackTransaction();
    }).rejects.toThrow('not a pending transaction');
  }

  async shouldThrowIfUnknownComparisonOperator() {
    await expect(() =>
      this.querier.findMany(User, {
        filter: { name: { $someInvalidOperator: 'some' } as any },
      })
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  async shouldRollback() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const count1 = await this.querier.count(User);
    expect(count1).toBe(3);
    await this.querier.beginTransaction();
    const count2 = await this.querier.count(User);
    expect(count2).toBe(count1);
    const deletedRows1 = await this.querier.removeMany(User, { status: null });
    expect(deletedRows1).toBe(count1);
    const deletedRows2 = await this.querier.removeMany(User, { status: null });
    expect(deletedRows2).toBe(0);
    const count3 = await this.querier.count(User);
    expect(count3).toBe(0);
    await this.querier.rollbackTransaction();
    const count4 = await this.querier.count(User);
    expect(count4).toBe(count1);
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
      this.querier.findOne(User, { project: { id: 1 } }),
      this.querier.findOne(Company, { project: { id: 1 } }),
    ]);

    const [firstItemId, secondItemId] = await this.querier.insertMany(Item, [
      {
        name: 'some item name a',
        userId: user.id,
        companyId: company.id,
      },
      {
        name: 'some item name b',
        userId: user.id,
        companyId: company.id,
      },
    ]);

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some inventory adjustment',
      userId: user.id,
      companyId: company.id,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
    });

    const inventoryAdjustment = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      populate: { itemAdjustments: {}, user: {} },
    });

    expect(inventoryAdjustment).toMatchObject({
      description: 'some inventory adjustment',
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
      user: {
        email: 'someemaila@example.com',
        name: 'Some Name A',
        password: '123456789a!',
      },
    });
  }

  async shouldRemoveMany() {
    await this.querier.beginTransaction();
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);
    const deletedRows1 = await this.querier.removeMany(User, { status: 1 });
    expect(deletedRows1).toBe(0);
    const deletedRows2 = await this.querier.removeMany(User, { status: null });
    expect(deletedRows2).toBe(3);
    await this.querier.commitTransaction();
  }

  async shouldThrowWhenCommitTransactionWithoutBeginTransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  }

  abstract createTables(): Promise<void>;

  abstract dropTables(): Promise<void>;
}
