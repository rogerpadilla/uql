import { Spec, createSpec, User, InventoryAdjustment, ItemAdjustment } from '../../test';
import { MySqlQuerier } from './mysqlQuerier';

class MySqlQuerierSpec implements Spec {
  querier: MySqlQuerier;

  beforeEach() {
    this.querier = new MySqlQuerier({
      query: () => Promise.resolve([{ insertId: 1, affectedRows: 1 }]),
      release: () => Promise.resolve(),
    });
    jest.spyOn(this.querier, 'query');
    jest.spyOn(this.querier, 'insertOne');
    jest.spyOn(this.querier, 'insert');
    jest.spyOn(this.querier, 'update');
    jest.spyOn(this.querier, 'remove');
    jest.spyOn(this.querier, 'find');
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
      'SELECT `id`, `companyId`, `userId`, `createdAt`, `updatedAt`, `status`, `name`, `email`, `password`' +
        ' FROM `User` WHERE `id` = 1 LIMIT 1'
    );
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldFindOne() {
    await this.querier.findOne(User, { filter: { companyId: '123' }, project: { id: 1, name: 1 } });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldFindOnePopulateOneToMany() {
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
      "SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `userId` = '1' LIMIT 1"
    );
    expect(this.querier.query).nthCalledWith(
      2,
      'SELECT `id`, `companyId`, `userId`, `createdAt`, `updatedAt`, `status`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ", `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN ('123', '456')"
    );
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insert).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(2);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldFindPopulateOneToMany() {
    const mock: InventoryAdjustment[] = [
      { id: '123', description: 'something a', userId: '1' },
      { id: '456', description: 'something b', userId: '1' },
    ];
    jest.spyOn(this.querier, 'query').mockResolvedValue(mock);

    await this.querier.find(InventoryAdjustment, {
      project: { id: 1 },
      filter: { userId: '1' },
      populate: { itemAdjustments: {} },
    });

    expect(this.querier.query).nthCalledWith(
      1,
      "SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `userId` = '1'"
    );
    expect(this.querier.query).nthCalledWith(
      2,
      'SELECT `id`, `companyId`, `userId`, `createdAt`, `updatedAt`, `status`, `itemId`, `number`, `buyPrice`, `storehouseId`' +
        ", `inventoryAdjustmentId` FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` IN ('123', '456')"
    );
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insert).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(2);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldFind() {
    await this.querier.find(User, {
      filter: { companyId: '123' },
      project: { id: 1, name: 1 },
      limit: 100,
    });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { companyId: '123' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.insertOne).toBeCalledTimes(1);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldInsertOneCascadeOneToOne() {
    await this.querier.insertOne(User, {
      name: 'some name',
      profile: { picture: 'abc', createdAt: 123 },
      createdAt: 123,
    });
    expect(this.querier.query).nthCalledWith(1, "INSERT INTO `User` (`name`, `createdAt`) VALUES ('some name', 123)");
    expect(this.querier.query).nthCalledWith(
      2,
      "INSERT INTO `user_profile` (`image`, `createdAt`, `userId`) VALUES ('abc', 123, 1)"
    );
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(2);
    expect(this.querier.insert).toBeCalledTimes(2);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldInsertOneCascadeOneToMany() {
    await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(
        /^INSERT INTO `InventoryAdjustment` \(`description`, `createdAt`\) VALUES \('some description', \d+\)$/
      )
    );
    expect(this.querier.query).nthCalledWith(
      2,
      expect.toMatch(
        /^INSERT INTO `ItemAdjustment` \(`buyPrice`, `inventoryAdjustmentId`, `createdAt`\) VALUES \(50, 1, \d+\), \(300, 1, \d+\)$/
      )
    );
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(1);
    expect(this.querier.insert).toBeCalledTimes(2);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdate() {
    await this.querier.update(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldUpdateOneById() {
    await this.querier.updateOneById(User, 5, { companyId: '123' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.update).toBeCalledTimes(1);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdCascadeOneToOne() {
    await this.querier.updateOneById(User, 1, {
      name: 'something',
      profile: { picture: 'xyz' },
    });
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE `User` SET `name` = 'something', `updatedAt` = \d+ WHERE `id` = 1$/)
    );
    expect(this.querier.query).nthCalledWith(
      2,
      expect.toMatch(/^UPDATE `user_profile` SET `image` = 'xyz', `updatedAt` = \d+ WHERE `userId` = 1$/)
    );
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insert).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(2);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdCascadeOneToOneNull() {
    await this.querier.updateOneById(User, 1, {
      name: 'something',
      profile: null,
    });
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE `User` SET `name` = 'something', `updatedAt` = \d+ WHERE `id` = 1$/)
    );
    expect(this.querier.query).nthCalledWith(2, 'DELETE FROM `user_profile` WHERE `userId` = 1');
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insert).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(1);
    expect(this.querier.remove).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdCascadeOneToMany() {
    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(
        /^UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = \d+ WHERE `id` = 1$/
      )
    );
    expect(this.querier.query).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');
    expect(this.querier.query).nthCalledWith(
      3,
      expect.toMatch(
        /^INSERT INTO `ItemAdjustment` \(`buyPrice`, `inventoryAdjustmentId`, `createdAt`\) VALUES \(50, 1, \d+\), \(300, 1, \d+\)$/
      )
    );
    expect(this.querier.query).toBeCalledTimes(3);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insert).toBeCalledTimes(1);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(1);
    expect(this.querier.remove).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdCascadeOneToManyNull() {
    await this.querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      itemAdjustments: null,
    });
    expect(this.querier.query).nthCalledWith(
      1,
      expect.toMatch(
        /^UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = \d+ WHERE `id` = 1$/
      )
    );
    expect(this.querier.query).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustmentId` = 1');
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.insert).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(1);
    expect(this.querier.remove).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldUpdateOneByIdUnaffectedRecord() {
    await expect(this.querier.updateOneById(User, 5, { companyId: '123' }));
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.update).toBeCalledTimes(1);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.remove).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldRemoveOneById() {
    await this.querier.removeOneById(User, 123);
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.remove).toBeCalledTimes(1);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldRemoveOneByIdUnaffectedRecord() {
    await expect(this.querier.removeOneById(User, 5));
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.remove).toBeCalledTimes(1);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldRemove() {
    await this.querier.remove(User, { companyId: '123' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.remove).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
    expect(this.querier.insertOne).toBeCalledTimes(0);
    expect(this.querier.update).toBeCalledTimes(0);
    expect(this.querier.find).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
  }

  async shouldCount() {
    jest.spyOn(this.querier, 'query').mockResolvedValue([{ count: 1 }]);

    await this.querier.count(User, { companyId: '123' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.query).toBeCalledWith("SELECT COUNT(*) count FROM `User` WHERE `companyId` = '123'");
    expect(this.querier.find).toBeCalledTimes(1);
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
    await this.querier.update(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.commitTransaction();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.release();
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.query).toBeCalledTimes(3);
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
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(2);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldThrowIfCommitWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.commitTransaction()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.query).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(1);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldThrowIfRollbackWithNoPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    expect(this.querier.query).toBeCalledTimes(0);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(1);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldThrowIfReleaseWithPendingTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await this.querier.update(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(this.querier.query).toBeCalledTimes(2);
    expect(this.querier.beginTransaction).toBeCalledTimes(1);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(1);
  }
}

createSpec(new MySqlQuerierSpec());
