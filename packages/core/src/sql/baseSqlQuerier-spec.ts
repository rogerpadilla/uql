import { User, InventoryAdjustment, Spec } from '../test';
import { BaseSqlQuerier } from './baseSqlQuerier';

export class BaseSqlQuerierSpec implements Spec {
  querier: BaseSqlQuerier;

  constructor(
    private readonly querierConstructor: new (conn: any) => BaseSqlQuerier,
    private readonly connection: any
  ) {}

  beforeEach() {
    this.querier = new this.querierConstructor.prototype.constructor(Object.create(this.connection));
    jest.spyOn(this.querier, 'query');
    jest.spyOn(this.querier, 'insertOne');
    jest.spyOn(this.querier, 'insertMany');
    jest.spyOn(this.querier, 'updateMany');
    jest.spyOn(this.querier, 'removeMany');
    jest.spyOn(this.querier, 'removeOneById');
    jest.spyOn(this.querier, 'findMany');
    jest.spyOn(this.querier, 'findOne');
    jest.spyOn(this.querier, 'findOneById');
    jest.spyOn(this.querier, 'beginTransaction');
    jest.spyOn(this.querier, 'commitTransaction');
    jest.spyOn(this.querier, 'rollbackTransaction');
    jest.spyOn(this.querier, 'release');
  }

  async shouldFindOneById() {
    await this.querier.findOneById(User, 1);
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.query).nthCalledWith(
      1,
      'SELECT id, companyId, userId, createdAt, updatedAt, status, name, email, password' +
        ' FROM User WHERE id = 1 LIMIT 1',
      { isSelect: true }
    );
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldFindOne() {
    await this.querier.findOne(User, { filter: { companyId: '123' }, project: { id: 1, name: 1 } });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.query).nthCalledWith(1, "SELECT id, name FROM User WHERE companyId = '123' LIMIT 1", {
      isSelect: true,
    });
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldFindOneAndPopulateOneToMany() {
    const mock: InventoryAdjustment[] = [
      { id: '123', description: 'something a', userId: '1' },
      { id: '456', description: 'something b', userId: '1' },
    ];
    jest.spyOn(this.querier, 'query').mockResolvedValue(mock);

    await this.querier.findOne(InventoryAdjustment, {
      project: { id: 1 },
      filter: { userId: '1' },
      populate: { itemAdjustments: {} },
    });

    expect(this.querier.query).nthCalledWith(
      1,
      "SELECT InventoryAdjustment.id FROM InventoryAdjustment WHERE userId = '1' LIMIT 1",
      { isSelect: true }
    );
    expect(this.querier.query).nthCalledWith(
      2,
      'SELECT id, companyId, userId, createdAt, updatedAt, status, itemId, number, buyPrice, storehouseId' +
        ", inventoryAdjustmentId FROM ItemAdjustment WHERE inventoryAdjustmentId IN ('123', '456')",
      { isSelect: true }
    );
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insertMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(2);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.removeOneById).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldFindManyAndPopulateOneToMany() {
    const mock: InventoryAdjustment[] = [
      { id: '123', description: 'something a', userId: '1' },
      { id: '456', description: 'something b', userId: '1' },
    ];
    jest.spyOn(this.querier, 'query').mockResolvedValue(mock);

    await this.querier.findMany(InventoryAdjustment, {
      project: { id: 1 },
      filter: { userId: '1' },
      populate: { itemAdjustments: {} },
    });

    expect(this.querier.query).nthCalledWith(
      1,
      "SELECT InventoryAdjustment.id FROM InventoryAdjustment WHERE userId = '1'",
      { isSelect: true }
    );
    expect(this.querier.query).nthCalledWith(
      2,
      'SELECT id, companyId, userId, createdAt, updatedAt, status, itemId, number, buyPrice, storehouseId' +
        ", inventoryAdjustmentId FROM ItemAdjustment WHERE inventoryAdjustmentId IN ('123', '456')",
      { isSelect: true }
    );
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insertMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(2);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldFindMany() {
    await this.querier.findMany(User, {
      filter: { companyId: '123' },
      project: { id: 1, name: 1 },
      limit: 100,
    });
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { companyId: '123' });
    expect(this.querier.insertOne).toBeCalledTimes(1);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      profile: { picture: 'abc' },
    });
    expect(this.querier.insertOne).toBeCalledTimes(2);
    expect(this.querier.insertMany).toBeCalledTimes(2);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
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
    expect(this.querier.insertOne).toBeCalledTimes(1);
    expect(this.querier.insertMany).toBeCalledTimes(2);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateMany() {
    await this.querier.updateMany(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, 5, { companyId: '123' });
    expect(this.querier.updateMany).toBeCalledTimes(1);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdAndCascadeOneToOne() {
    await this.querier.updateOneById(User, 1, {
      name: 'something',
      profile: { picture: 'xyz' },
    });
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insertMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(2);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdAndCascadeOneToOneNull() {
    await this.querier.updateOneById(User, 1, {
      name: 'something',
      profile: null,
    });
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insertMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(1);
    expect(this.querier.removeMany).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdAndCascadeOneToMany() {
    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insertMany).toBeCalledTimes(1);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(1);
    expect(this.querier.removeMany).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      itemAdjustments: null,
    });
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insertMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(1);
    expect(this.querier.removeMany).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdUnaffectedRecord() {
    await expect(this.querier.updateOneById(User, 5, { companyId: '123' }));
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(1);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.removeMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldRemoveOneById() {
    await this.querier.removeOneById(User, 123);
    expect(this.querier.removeMany).toBeCalledTimes(1);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldRemoveOneByIdUnaffectedRecord() {
    await expect(this.querier.removeOneById(User, 5));
    expect(this.querier.removeMany).toBeCalledTimes(1);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldRemoveMany() {
    await this.querier.removeMany(User, { companyId: '123' });
    expect(this.querier.removeMany).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.updateMany).toBeCalledTimes(0);
    expect(this.querier.findMany).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldCount() {
    jest.spyOn(this.querier, 'query').mockResolvedValue([{ count: 1 }]);

    await this.querier.count(User, { companyId: '123' });
    expect(this.querier.findMany).toBeCalledTimes(1);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction); //.toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldUseTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.updateMany(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.commitTransaction();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.release();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.beginTransaction).toBeCalledTimes(1);
    expect(this.querier.commitTransaction).toBeCalledTimes(1);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(1);
  }

  async shouldThrowIfTransactionIsPending() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.beginTransaction).toBeCalledTimes(2);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldThrowIfCommitWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.commitTransaction()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(1);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldThrowIfRollbackWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(1);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldThrowIfReleaseWithPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.updateMany(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.beginTransaction).toBeCalledTimes(1);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(1);
  }
}
