import { User, InventoryAdjustment } from '../test';
import { QueryUpdateResult } from '../type';
import { BaseSqlQuerier } from '../driver';
import { MySqlQuerier } from '../driver/mysql';

xdescribe('baseQuerier', () => {
  let mockRes: User[] | QueryUpdateResult | { count: number }[];
  let querier: BaseSqlQuerier;

  beforeEach(() => {
    mockRes = undefined;
    querier = new MySqlQuerier(undefined);
    jest.spyOn(querier, 'query').mockImplementation(() => Promise.resolve(mockRes));
    jest.spyOn(querier, 'insertOne');
    jest.spyOn(querier, 'insert');
    jest.spyOn(querier, 'update');
    jest.spyOn(querier, 'remove');
    jest.spyOn(querier, 'find');
    jest.spyOn(querier, 'beginTransaction');
    jest.spyOn(querier, 'commitTransaction');
    jest.spyOn(querier, 'rollbackTransaction');
    jest.spyOn(querier, 'release');
  });

  it('insertOne', async () => {
    const mock: QueryUpdateResult = { insertId: 1 };
    mockRes = mock;
    const resp = await querier.insertOne(User, { companyId: '123' });
    expect(resp).toEqual(mock.insertId);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.insertOne).toBeCalledTimes(1);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('insertOne cascade oneToOne', async () => {
    const mock: QueryUpdateResult = { insertId: 1 };
    mockRes = mock;
    const resp = await querier.insertOne(User, {
      name: 'some name',
      profile: { picture: 'abc', createdAt: 123 },
      createdAt: 123,
    });
    expect(resp).toEqual(mock.insertId);
    expect(querier.query).nthCalledWith(1, "INSERT INTO `User` (`name`, `createdAt`) VALUES ('some name', 123)");
    expect(querier.query).nthCalledWith(
      2,
      "INSERT INTO `user_profile` (`image`, `createdAt`, `userId`) VALUES ('abc', 123, 1)"
    );
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(2);
    expect(querier.insert).toBeCalledTimes(2);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('insertOne cascade oneToMany', async () => {
    const mock: QueryUpdateResult = { insertId: 1 };
    mockRes = mock;
    const resp = await querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });
    expect(resp).toEqual(mock.insertId);
    expect(querier.query).nthCalledWith(
      1,
      expect.toMatch(
        /^INSERT INTO `InventoryAdjustment` \(`description`, `createdAt`\) VALUES \('some description', \d+\)$/
      )
    );
    expect(querier.query).nthCalledWith(
      2,
      expect.toMatch(
        /^INSERT INTO `ItemAdjustment` \(`buyPrice`, `inventoryAdjustment`, `createdAt`\) VALUES \(50, 1, \d+\), \(300, 1, \d+\)$/
      )
    );
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(1);
    expect(querier.insert).toBeCalledTimes(2);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('updateOneById', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.updateOneById(User, 5, { companyId: '123' });
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.update).toBeCalledTimes(1);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('updateOneById cascade oneToOne', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.updateOneById(User, 1, {
      name: 'something',
      profile: { picture: 'xyz' },
    });
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE `User` SET `name` = 'something', `updatedAt` = \d+ WHERE `id` = 1$/)
    );
    expect(querier.query).nthCalledWith(
      2,
      expect.toMatch(/^UPDATE `user_profile` SET `image` = 'xyz', `updatedAt` = \d+ WHERE `userId` = 1$/)
    );
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.insert).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(2);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('updateOneById cascade oneToOne null', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.updateOneById(User, 1, {
      name: 'something',
      profile: null,
    });
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).nthCalledWith(
      1,
      expect.toMatch(/^UPDATE `User` SET `name` = 'something', `updatedAt` = \d+ WHERE `id` = 1$/)
    );
    expect(querier.query).nthCalledWith(2, 'DELETE FROM `user_profile` WHERE `userId` = 1');
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.insert).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(1);
    expect(querier.remove).toBeCalledTimes(1);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('updateOneById cascade oneToMany', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).nthCalledWith(
      1,
      expect.toMatch(
        /^UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = \d+ WHERE `id` = 1$/
      )
    );
    expect(querier.query).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustment` = 1');
    expect(querier.query).nthCalledWith(
      3,
      expect.toMatch(
        /^INSERT INTO `ItemAdjustment` \(`buyPrice`, `inventoryAdjustment`, `createdAt`\) VALUES \(50, 1, \d+\), \(300, 1, \d+\)$/
      )
    );
    expect(querier.query).toBeCalledTimes(3);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.insert).toBeCalledTimes(1);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(1);
    expect(querier.remove).toBeCalledTimes(1);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('updateOneById cascade oneToMany null', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.updateOneById(InventoryAdjustment, 1, {
      description: 'some description',
      itemAdjustments: null,
    });
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).nthCalledWith(
      1,
      expect.toMatch(
        /^UPDATE `InventoryAdjustment` SET `description` = 'some description', `updatedAt` = \d+ WHERE `id` = 1$/
      )
    );
    expect(querier.query).nthCalledWith(2, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustment` = 1');
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.insert).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(1);
    expect(querier.remove).toBeCalledTimes(1);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('updateOneById unaffected record', async () => {
    const mock: QueryUpdateResult = { affectedRows: 0 };
    mockRes = mock;
    await expect(querier.updateOneById(User, 5, { companyId: '123' })).resolves.toBe(mock.affectedRows);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.update).toBeCalledTimes(1);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('findOneById', async () => {
    const mock: User = { id: '1', name: 'something' };
    mockRes = [mock];
    const resp1 = await querier.findOneById(User, 1);
    expect(resp1).toEqual(mock);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.query).nthCalledWith(
      1,
      'SELECT `id`, `companyId`, `userId`, `createdAt`, `updatedAt`, `status`, `name`, `email`, `password` FROM `User` WHERE `id` = 1 LIMIT 1'
    );
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
  });

  it('findOne', async () => {
    const mock: User = { id: '1', name: 'something' };
    mockRes = [mock];
    const resp = await querier.findOne(User, { filter: { companyId: '123' }, project: { id: 1, name: 1 } });
    expect(resp).toEqual(mock);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
  });

  it('findOne populate oneToMany', async () => {
    const mock: InventoryAdjustment[] = [
      { id: '123', description: 'something a', userId: '1' },
      { id: '456', description: 'something b', userId: '1' },
    ];
    mockRes = mock;
    await querier.findOne(InventoryAdjustment, {
      project: { id: 1 },
      filter: { userId: '1' },
      populate: { itemAdjustments: {} },
    });
    expect(querier.query).nthCalledWith(
      1,
      "SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `userId` = '1' LIMIT 1"
    );
    expect(querier.query).nthCalledWith(
      2,
      "SELECT `id`, `companyId`, `userId`, `createdAt`, `updatedAt`, `status`, `item`, `number`, `buyPrice`, `storehouse`, `inventoryAdjustment` FROM `ItemAdjustment` WHERE `inventoryAdjustment` IN ('123', '456')"
    );
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.insert).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(2);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('find populate oneToMany', async () => {
    const mock: InventoryAdjustment[] = [
      { id: '123', description: 'something a', userId: '1' },
      { id: '456', description: 'something b', userId: '1' },
    ];
    mockRes = mock;
    await querier.find(InventoryAdjustment, {
      project: { id: 1 },
      filter: { userId: '1' },
      populate: { itemAdjustments: {} },
    });
    expect(querier.query).nthCalledWith(
      1,
      "SELECT `InventoryAdjustment`.`id` FROM `InventoryAdjustment` WHERE `userId` = '1'"
    );
    expect(querier.query).nthCalledWith(
      2,
      "SELECT `id`, `companyId`, `userId`, `createdAt`, `updatedAt`, `status`, `item`, `number`, `buyPrice`, `storehouse`, `inventoryAdjustment` FROM `ItemAdjustment` WHERE `inventoryAdjustment` IN ('123', '456')"
    );
    expect(querier.query).toBeCalledTimes(2);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.insert).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(2);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.remove).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('find', async () => {
    const mock: User[] = [{ id: '1', name: 'something' }];
    mockRes = mock;
    const resp = await querier.find(User, {
      filter: { companyId: '123' },
      project: { id: 1, name: 1 },
      limit: 100,
    });
    expect(resp).toEqual(mock);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
  });

  it('removeOneById', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.removeOneById(User, 123);
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.remove).toBeCalledTimes(1);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('removeOneById unaffected record', async () => {
    const mock: QueryUpdateResult = { affectedRows: 0 };
    mockRes = mock;
    await expect(querier.removeOneById(User, 5)).resolves.toBe(mock.affectedRows);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.remove).toBeCalledTimes(1);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('remove', async () => {
    const mock: QueryUpdateResult = { affectedRows: 1 };
    mockRes = mock;
    const resp = await querier.remove(User, { companyId: '123' });
    expect(resp).toEqual(mock.affectedRows);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.remove).toBeCalledTimes(1);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.insertOne).toBeCalledTimes(0);
    expect(querier.update).toBeCalledTimes(0);
    expect(querier.find).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
  });

  it('count', async () => {
    const mock = 1;
    mockRes = [{ count: mock }];
    const resp = await querier.count(User, { companyId: '123' });
    expect(resp).toEqual(mock);
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.query).toBeCalledWith("SELECT COUNT(*) count FROM `User` WHERE `companyId` = '123'");
    expect(querier.find).toBeCalledTimes(1);
    expect(querier.release).toBeCalledTimes(0);
    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
  });
});
