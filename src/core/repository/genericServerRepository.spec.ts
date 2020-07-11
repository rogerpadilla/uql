import { QueryUpdateResult } from '../type';
import { Querier, Transactional } from '../datasource';
import MySql2QuerierPool from '../datasource/mysql/mysql2QuerierPool';
import { MySqlQuerier } from '../datasource/mysql/mysqlQuerier';
import { SqlQuerier } from '../datasource/sqlQuerier';
import { User, Item, InventoryAdjustment } from '../entity/entityMock';
import { initCorozo } from '../config';
import { Repository } from './decorator';
import { GenericServerRepository } from './genericServerRepository';
import { ServerRepository } from './type';

let mockRes: User[] | QueryUpdateResult | { count: number }[];
let querier: SqlQuerier;
let repository: ServerRepository<User, number>;
const originalGetQuerier = MySql2QuerierPool.prototype.getQuerier;

beforeEach(() => {
  mockRes = undefined;
  initCorozo({ datasource: { driver: 'mysql2' }, defaultRepositoryClass: GenericServerRepository });
  MySql2QuerierPool.prototype.getQuerier = () => Promise.resolve(querier as MySqlQuerier);

  querier = new MySqlQuerier(undefined);
  jest.spyOn(querier, 'query').mockImplementation(() => Promise.resolve(mockRes));
  jest.spyOn(querier, 'insertOne');
  jest.spyOn(querier, 'insert');
  jest.spyOn(querier, 'update');
  jest.spyOn(querier, 'remove');
  jest.spyOn(querier, 'find');
  jest.spyOn(querier, 'beginTransaction');
  jest.spyOn(querier, 'commit');
  jest.spyOn(querier, 'rollback');
  jest.spyOn(querier, 'release').mockImplementation(() => Promise.resolve());

  repository = new GenericServerRepository(User);
  jest.spyOn(repository, 'insertOne');
  jest.spyOn(repository, 'updateOneById');
});

afterEach(() => {
  MySql2QuerierPool.prototype.getQuerier = originalGetQuerier;
});

it('insertOne', async () => {
  const mock: QueryUpdateResult = { insertId: 1 };
  mockRes = mock;
  const resp = await repository.insertOne({ company: 123 });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.insertOne).toBeCalledTimes(1);
  expect(querier.find).not.toBeCalled();
  expect(querier.update).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('insertOne cascade oneToOne', async () => {
  const mock: QueryUpdateResult = { insertId: 1 };
  mockRes = mock;
  const resp = await repository.insertOne({
    name: 'some name',
    profile: { picture: 'abc' },
  });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).nthCalledWith(1, 'START TRANSACTION');
  expect(querier.query).nthCalledWith(2, "INSERT INTO `user` (`name`) VALUES ('some name')");
  expect(querier.query).nthCalledWith(3, "INSERT INTO `user_profile` (`image`) VALUES ('abc')");
  expect(querier.query).nthCalledWith(4, 'COMMIT');
  expect(querier.query).toBeCalledTimes(4);
  expect(querier.insertOne).toBeCalledTimes(2);
  expect(querier.insert).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.update).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('insertOne cascade oneToMany', async () => {
  const mock: QueryUpdateResult = { insertId: 1 };
  mockRes = mock;
  const repo = new GenericServerRepository(InventoryAdjustment);
  const resp = await repo.insertOne({
    description: 'some description',
    itemsAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
  });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).nthCalledWith(1, 'START TRANSACTION');
  expect(querier.query).nthCalledWith(
    2,
    "INSERT INTO `InventoryAdjustment` (`description`) VALUES ('some description')"
  );
  expect(querier.query).nthCalledWith(
    3,
    'INSERT INTO `ItemAdjustment` (`buyPrice`, `inventoryAdjustment`) VALUES (50, 1), (300, 1)'
  );
  expect(querier.query).nthCalledWith(4, 'COMMIT');
  expect(querier.query).toBeCalledTimes(4);
  expect(querier.insertOne).toBeCalledTimes(1);
  expect(querier.insert).toBeCalledTimes(1);
  expect(querier.find).not.toBeCalled();
  expect(querier.update).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('updateOneById', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await repository.updateOneById(5, { company: 123 });
  expect(resp).toEqual(undefined);
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.find).not.toBeCalled();
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('updateOneById cascade oneToOne', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await repository.updateOneById(1, {
    name: 'something',
    profile: { picture: 'xyz' },
  });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).nthCalledWith(1, 'START TRANSACTION');
  expect(querier.query).nthCalledWith(2, "UPDATE `user` SET `name` = 'something' WHERE `id` = 1");
  expect(querier.query).nthCalledWith(3, "UPDATE `user_profile` SET `image` = 'xyz' WHERE `user` = 1");
  expect(querier.query).nthCalledWith(4, 'COMMIT');
  expect(querier.query).toBeCalledTimes(4);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.insert).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.update).toBeCalledTimes(2);
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('updateOneById cascade oneToOne null', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await repository.updateOneById(1, {
    name: 'something',
    profile: null,
  });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).nthCalledWith(1, 'START TRANSACTION');
  expect(querier.query).nthCalledWith(2, "UPDATE `user` SET `name` = 'something' WHERE `id` = 1");
  expect(querier.query).nthCalledWith(3, 'DELETE FROM `user_profile` WHERE `user` = 1');
  expect(querier.query).nthCalledWith(4, 'COMMIT');
  expect(querier.query).toBeCalledTimes(4);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.insert).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.remove).toBeCalledTimes(1);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('updateOneById cascade oneToMany', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const repo = new GenericServerRepository(InventoryAdjustment);
  const resp = await repo.updateOneById(1, {
    description: 'some description',
    itemsAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
  });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).nthCalledWith(1, 'START TRANSACTION');
  expect(querier.query).nthCalledWith(
    2,
    "UPDATE `InventoryAdjustment` SET `description` = 'some description' WHERE `id` = 1"
  );
  expect(querier.query).nthCalledWith(3, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustment` = 1');
  expect(querier.query).nthCalledWith(
    4,
    'INSERT INTO `ItemAdjustment` (`buyPrice`, `inventoryAdjustment`) VALUES (50, 1), (300, 1)'
  );
  expect(querier.query).nthCalledWith(5, 'COMMIT');
  expect(querier.query).toBeCalledTimes(5);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.insert).toBeCalledTimes(1);
  expect(querier.find).not.toBeCalled();
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.remove).toBeCalledTimes(1);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('updateOneById cascade oneToMany null', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const repo = new GenericServerRepository(InventoryAdjustment);
  const resp = await repo.updateOneById(1, {
    description: 'some description',
    itemsAdjustments: null,
  });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).nthCalledWith(1, 'START TRANSACTION');
  expect(querier.query).nthCalledWith(
    2,
    "UPDATE `InventoryAdjustment` SET `description` = 'some description' WHERE `id` = 1"
  );
  expect(querier.query).nthCalledWith(3, 'DELETE FROM `ItemAdjustment` WHERE `inventoryAdjustment` = 1');
  expect(querier.query).nthCalledWith(4, 'COMMIT');
  expect(querier.query).toBeCalledTimes(4);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.insert).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.remove).toBeCalledTimes(1);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('updateOneById unaffected record', async () => {
  const mock: QueryUpdateResult = { affectedRows: 0 };
  mockRes = mock;
  await expect(repository.updateOneById(5, { company: 123 })).rejects.toThrow('Unaffected record');
  expect(repository.updateOneById).toBeCalledTimes(1);
  expect(repository.insertOne).not.toBeCalled();
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.find).not.toBeCalled();
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).toBeCalledTimes(1);
});

it('saveOne insert', async () => {
  const mock: QueryUpdateResult = { insertId: 5 };
  mockRes = mock;
  const resp = await repository.saveOne({ company: 123 });
  expect(resp).toEqual(mock.insertId);
  expect(repository.insertOne).toBeCalledTimes(1);
  expect(repository.updateOneById).not.toBeCalled();
  expect(querier.insertOne).toBeCalledTimes(1);
  expect(querier.update).not.toBeCalled();
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.find).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('saveOne update', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await repository.saveOne({ id: 5, company: 123 });
  expect(resp).toEqual(5);
  expect(repository.updateOneById).toBeCalledTimes(1);
  expect(repository.insertOne).not.toBeCalled();
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.find).not.toBeCalled();
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.remove).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('findOneById', async () => {
  const mock: User = { id: 1, name: 'something' };
  mockRes = [mock];
  const resp = await repository.findOneById(1);
  expect(resp).toEqual(mock);
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commit).not.toBeCalled();
  expect(querier.rollback).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
});

it('findOne', async () => {
  const mock: User = { id: 1, name: 'something' };
  mockRes = [mock];
  const resp = await repository.findOne({ filter: { company: 123 }, project: { id: 1, name: 1 } });
  expect(resp).toEqual(mock);
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commit).not.toBeCalled();
  expect(querier.rollback).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
});

it('find', async () => {
  const mock: User[] = [{ id: 1, name: 'something' }];
  mockRes = mock;
  const resp = await repository.find({ filter: { company: 123 }, project: { id: 1, name: 1 }, limit: 100 });
  expect(resp).toEqual(mock);
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commit).not.toBeCalled();
  expect(querier.rollback).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
});

it('removeOneById', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await repository.removeOneById(123);
  expect(resp).toEqual(undefined);
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.remove).toBeCalledTimes(1);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.update).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).not.toBeCalled();
});

it('removeOneById unaffected record', async () => {
  const mock: QueryUpdateResult = { affectedRows: 0 };
  mockRes = mock;
  await expect(repository.removeOneById(5)).rejects.toThrow('Unaffected record');
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.remove).toBeCalledTimes(1);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.update).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).toBeCalledTimes(1);
});

it('remove', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await repository.remove({ company: 123 });
  expect(resp).toEqual(mock.affectedRows);
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.remove).toBeCalledTimes(1);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.insertOne).not.toBeCalled();
  expect(querier.update).not.toBeCalled();
  expect(querier.find).not.toBeCalled();
  expect(querier.rollback).not.toBeCalled();
});

it('count', async () => {
  const mock = 1;
  mockRes = [{ count: mock }];
  const resp = await repository.count({ company: 123 });
  expect(resp).toEqual(mock);
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.find).toBeCalledTimes(0);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commit).not.toBeCalled();
  expect(querier.rollback).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
});

it('rollback - insertOne', async () => {
  jest.spyOn(querier, 'insertOne').mockImplementationOnce(() => Promise.reject(new Error('Some Error')));
  await expect(repository.saveOne({ company: 123 })).rejects.toThrow('Some Error');
  expect(querier.insertOne).toBeCalledTimes(1);
  expect(querier.update).toBeCalledTimes(0);
  expect(querier.query).toBeCalledTimes(2);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).toBeCalledTimes(1);
});

it('rollback - update', async () => {
  jest.spyOn(querier, 'update').mockImplementationOnce(() => Promise.reject(new Error('Some Error')));
  await expect(repository.saveOne({ id: 1, company: 123 })).rejects.toThrow('Some Error');
  expect(querier.insertOne).toBeCalledTimes(0);
  expect(querier.update).toBeCalledTimes(1);
  expect(querier.query).toBeCalledTimes(2);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).toBeCalledTimes(1);
});

it('rollback - commit', async () => {
  const mock: QueryUpdateResult = { insertId: 5 };
  mockRes = mock;
  jest.spyOn(querier, 'commit').mockImplementationOnce(() => Promise.reject(new Error('Some Error')));
  await expect(repository.saveOne({ company: 123 })).rejects.toThrow('Some Error');
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commit).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(1);
  expect(querier.rollback).toBeCalledTimes(1);
});

it('missing @InjectQuerier()', () => {
  const mock: QueryUpdateResult = { insertId: 1 };
  mockRes = mock;

  expect(() => {
    @Repository()
    class ItemRepository extends GenericServerRepository<Item, number> {
      constructor() {
        super(Item);
      }

      @Transactional({ propagation: 'required' })
      insertOne(body: Item, quer?: Querier) {
        return Promise.resolve<any>(undefined);
      }
    }
  }).toThrow(`Missing decorator @InjectQuerier() in one of the parameters of 'ItemRepository.insertOne'`);
});
