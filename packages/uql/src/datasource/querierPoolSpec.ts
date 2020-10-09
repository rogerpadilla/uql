import { getUqlOptions, setUqlOptions } from 'uql/config';
import { Company, InventoryAdjustment, Item, ItemAdjustment, Tax, TaxCategory, User } from 'uql/mock';
import { QuerierContract, QuerierPool, QuerySort } from 'uql/type';
import { getQuerier } from './querierPool';

export abstract class QuerierPoolSpec {
  readonly entities = [InventoryAdjustment, ItemAdjustment, Item, Tax, TaxCategory, Company, User] as const;
  querier: QuerierContract;

  constructor(readonly pool: QuerierPool) {}

  async beforeAll() {
    try {
      this.querier = await this.pool.getQuerier();
      await this.dropTables();
      await this.createTables();
    } finally {
      await this.querier.release();
    }
  }

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
  }

  async afterEach() {
    await this.querier.release();
  }

  async afterAll() {
    await this.pool.end();
  }

  async shouldInsert() {
    const ids = await this.querier.insert(User, [
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
    const userId = await this.querier.insertOne(User, {
      name: 'Some Name C',
      email: 'someemailc@example.com',
      password: '123456789z!',
    });
    expect(userId).toBeDefined();

    const companyId = await this.querier.insertOne(Company, {
      name: 'Some Name C',
      user: String(userId),
    });
    expect(companyId).toBeDefined();

    const affectedRows = await this.querier.update(
      User,
      {
        id: userId,
      },
      {
        company: companyId,
      }
    );
    expect(affectedRows).toBe(1);

    const taxCategoryId = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name C',
      description: 'Some Description Z',
      user: String(userId),
      company: String(companyId),
    });
    expect(taxCategoryId).toBeDefined();
  }

  async shouldFind() {
    const users = await this.querier.find(User, {
      project: { name: 1 },
      skip: 1,
      limit: 2,
      sort: {
        'User.id': 1,
      } as QuerySort<User>,
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

  async shouldFindPopulate() {
    const users = await this.querier.find(User, {
      project: { name: 1, email: 1, password: 1 },
      populate: {
        company: {
          project: {
            name: 1,
          },
        },
      },
      sort: {
        'User.id': 1,
      } as QuerySort<User>,
    });

    expect(users).toMatchObject([
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
      {
        name: 'Some Name C',
        email: 'someemailc@example.com',
        company: {
          name: 'Some Name C',
        },
      },
    ]);

    const foundOne = await this.querier.findOne(User, {
      project: {
        name: 1,
        email: 1,
      },
      populate: {
        company: {
          project: {
            name: 1,
          },
        },
      },
      filter: {
        email: 'someemailc@example.com',
      },
    });

    expect(foundOne).toMatchObject({
      name: 'Some Name C',
      email: 'someemailc@example.com',
      company: {
        name: 'Some Name C',
      },
    });
  }

  async shouldCount() {
    const count1 = await this.querier.count(User);
    expect(count1).toBe(3);
    const count2 = await this.querier.count(User, { status: null });
    expect(count2).toBe(3);
    const count3 = await this.querier.count(User, { status: 1 });
    expect(count3).toBe(0);
  }

  async shouldUpdate() {
    const updatedRows1 = await this.querier.update(User, { status: 1 }, { status: null });
    expect(updatedRows1).toBe(0);
    const updatedRows2 = await this.querier.update(User, { status: null }, { status: 1 });
    expect(updatedRows2).toBe(3);
    const updatedRows3 = await this.querier.update(User, { status: 1 }, { status: null });
    expect(updatedRows3).toBe(3);
  }

  async shouldThrowWhenRollbackTransactionWithoutBeginTransaction() {
    await expect(async () => {
      await this.querier.rollbackTransaction();
    }).rejects.toThrow('not a pending transaction');
  }

  async shouldFindUnknownComparisonOperator() {
    await expect(() =>
      this.querier.find(User, {
        filter: { name: { $someInvalidOperator: 'some' } as unknown },
      })
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  async shouldRollback() {
    const count1 = await this.querier.count(User);
    expect(count1).toBe(3);
    await this.querier.beginTransaction();
    const count2 = await this.querier.count(User);
    expect(count2).toBe(count1);
    const deletedRows1 = await this.querier.remove(User, { status: null });
    expect(deletedRows1).toBe(count1);
    const deletedRows2 = await this.querier.remove(User, { status: null });
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
    const [user, company] = await Promise.all([
      this.querier.findOne(User, { project: { id: 1 } }),
      this.querier.findOne(Company, { project: { id: 1 } }),
    ]);

    const [itemsIds, inventoryAdjustmentId] = await Promise.all([
      this.querier.insert(Item, [
        {
          name: 'some item name a',
          user: user.id,
          company: company.id,
        },
        {
          name: 'some item name b',
          user: user.id,
          company: company.id,
        },
      ]),

      this.querier.insertOne(InventoryAdjustment, {
        description: 'some inventory adjustment',
        user: user.id,
        company: company.id,
      }),
    ]);

    await this.querier.insert(ItemAdjustment, [
      { buyPrice: 1000, item: itemsIds[0] },
      { buyPrice: 2000, item: itemsIds[2] },
    ]);

    const inventoryAdjustment = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      populate: { itemsAdjustments: {}, user: {} },
    });

    expect(inventoryAdjustment).toEqual({
      company: '5f7c91c3e5b60d3681f31cb4',
      description: 'some inventory adjustment',
      itemsAdjustments: undefined,
      user: {
        email: 'someemaila@example.com',
        name: 'Some Name A',
        password: '123456789a!',
        status: null,
      },
    });
  }

  async shouldRemove() {
    await this.querier.beginTransaction();
    const deletedRows1 = await this.querier.remove(User, { status: 1 });
    expect(deletedRows1).toBe(0);
    const deletedRows2 = await this.querier.remove(User, { status: null });
    expect(deletedRows2).toBe(3);
    await this.querier.commitTransaction();
  }

  async shouldThrowWhenCommitTransactionWithoutBeginTransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldThrowWhenNoDatasourceConfig() {
    await expect(getQuerier()).rejects.toThrow('datasource configuration has not been set');
  }

  async shouldThrowWhenUnknownDriver() {
    const opts = getUqlOptions();
    setUqlOptions({ datasource: { driver: 'xyz' as any } });
    await expect(getQuerier()).rejects.toThrow(`unknown driver 'xyz'`);
    setUqlOptions(opts);
  }

  abstract createTables(): void;

  abstract dropTables(): void;
}
