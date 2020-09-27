import { User } from 'uql/mock';
import { QueryUpdateResult } from 'uql/type';
import { MySqlQuerier } from './mysqlQuerier';

let mockRes: User[] | QueryUpdateResult;
let querier: MySqlQuerier;

beforeEach(() => {
  mockRes = undefined;
  querier = new MySqlQuerier({
    query: () => {
      const res = [mockRes];
      return Promise.resolve(res);
    },
    release: () => Promise.resolve(),
  });
  jest.spyOn(querier, 'query');
  jest.spyOn(querier, 'beginTransaction');
  jest.spyOn(querier, 'commitTransaction');
  jest.spyOn(querier, 'rollbackTransaction');
  jest.spyOn(querier, 'release');
});

it('find', async () => {
  const mock: User[] = [{ id: '1', name: 'something' }];
  mockRes = mock;
  const resp = await querier.find(User, {
    project: { id: 1, name: 1 },
    filter: { company: '123' },
    limit: 100,
  });
  expect(resp).toEqual(mock);
  expect(querier.query).toBeCalledWith("SELECT `id`, `name` FROM `User` WHERE `company` = '123' LIMIT 100");
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).not.toBeCalled();
});

it('remove', async () => {
  const mock: QueryUpdateResult = { affectedRows: 1 };
  mockRes = mock;
  const resp = await querier.remove(User, { company: '123' });
  expect(resp).toEqual(mock.affectedRows);
  expect(querier.query).toBeCalledWith("DELETE FROM `User` WHERE `company` = '123'");
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).not.toBeCalled();
});

it('insertOne', async () => {
  const mock: QueryUpdateResult = { insertId: '1' };
  mockRes = mock;
  const resp = await querier.insertOne(User, { company: '123' });
  expect(resp).toEqual(mock.insertId);
  expect(querier.query).toBeCalledWith(
    expect.toMatch(/^INSERT INTO `User` \(`company`, `createdAt`\) VALUES \('123', \d+\)$/)
  );
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).not.toBeCalled();
});

it('update', async () => {
  const mock: QueryUpdateResult = { affectedRows: 5 };
  mockRes = mock;
  const resp = await querier.update(User, { id: '5' }, { name: 'Hola' });
  expect(resp).toEqual(mock.affectedRows);
  expect(querier.query).toBeCalledWith(
    expect.toMatch(/^UPDATE `User` SET `name` = 'Hola', `updatedAt` = \d+ WHERE `id` = '5'$/)
  );
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).not.toBeCalled();
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).not.toBeCalled();
});

it('transaction', async () => {
  const mock: QueryUpdateResult = { affectedRows: 5 };
  mockRes = mock;
  expect(querier.hasOpenTransaction).toBeFalsy();
  await querier.beginTransaction();
  expect(querier.hasOpenTransaction).toBe(true);
  await querier.update(User, { id: '5' }, { name: 'Hola' });
  expect(querier.hasOpenTransaction).toBe(true);
  await querier.commitTransaction();
  expect(querier.hasOpenTransaction).toBeFalsy();
  await querier.release();
  expect(querier.hasOpenTransaction).toBeFalsy();
  expect(querier.query).toBeCalledTimes(3);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commitTransaction).toBeCalledTimes(1);
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
});

it('transaction beging pending', async () => {
  expect(querier.hasOpenTransaction).toBeFalsy();
  await querier.beginTransaction();
  expect(querier.hasOpenTransaction).toBe(true);
  await expect(querier.beginTransaction()).rejects.toThrow('There is a pending transaction.');
  expect(querier.hasOpenTransaction).toBe(true);
  expect(querier.query).toBeCalledTimes(1);
  expect(querier.beginTransaction).toBeCalledTimes(2);
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).not.toBeCalled();
});

it('transaction commit no pending', async () => {
  expect(querier.hasOpenTransaction).toBeFalsy();
  await expect(querier.commitTransaction()).rejects.toThrow('There is not a pending transaction.');
  expect(querier.hasOpenTransaction).toBeFalsy();
  expect(querier.query).toBeCalledTimes(0);
  expect(querier.beginTransaction).toBeCalledTimes(0);
  expect(querier.commitTransaction).toBeCalledTimes(1);
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(0);
});

it('transaction rollback no pending', async () => {
  expect(querier.hasOpenTransaction).toBeFalsy();
  await expect(querier.rollbackTransaction()).rejects.toThrow('There is not a pending transaction.');
  expect(querier.hasOpenTransaction).toBeFalsy();
  expect(querier.query).toBeCalledTimes(0);
  expect(querier.beginTransaction).toBeCalledTimes(0);
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).toBeCalledTimes(1);
  expect(querier.release).toBeCalledTimes(0);
});

it('transaction release pending', async () => {
  const mock: QueryUpdateResult = { affectedRows: 5 };
  mockRes = mock;
  expect(querier.hasOpenTransaction).toBeFalsy();
  await querier.beginTransaction();
  expect(querier.hasOpenTransaction).toBe(true);
  await querier.update(User, { id: '5' }, { name: 'Hola' });
  expect(querier.hasOpenTransaction).toBe(true);
  await expect(querier.release()).rejects.toThrow('Querier should not be released while there is an open transaction.');
  expect(querier.hasOpenTransaction).toBe(true);
  expect(querier.query).toBeCalledTimes(2);
  expect(querier.beginTransaction).toBeCalledTimes(1);
  expect(querier.commitTransaction).not.toBeCalled();
  expect(querier.rollbackTransaction).not.toBeCalled();
  expect(querier.release).toBeCalledTimes(1);
});
