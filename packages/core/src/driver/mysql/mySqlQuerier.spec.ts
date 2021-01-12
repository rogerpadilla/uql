import { Spec, createSpec, User } from '../../test';
import { QueryUpdateResult } from '../../type';
import { MySqlQuerier } from './mysqlQuerier';

class MySqlQuerierSpec implements Spec {
  querier: MySqlQuerier;

  beforeEach() {
    this.querier = new MySqlQuerier({
      query: () => Promise.resolve([{}]),
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

  async shouldFind() {
    await this.querier.find(User, {
      project: { id: 1, name: 1 },
      filter: { company: '123' },
      limit: 100,
    });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldRemove() {
    await this.querier.remove(User, { company: '123' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
    expect(this.querier.release).toBeCalledTimes(0);
  }

  async shouldInsertOne() {
    await this.querier.insertOne(User, { company: '123' });
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

  async shouldUpdate() {
    await this.querier.update(User, { id: '5' }, { name: 'Hola' });
    expect(this.querier.query).toBeCalledTimes(1);
    expect(this.querier.beginTransaction).toBeCalledTimes(0);
    expect(this.querier.commitTransaction).toBeCalledTimes(0);
    expect(this.querier.rollbackTransaction).toBeCalledTimes(0);
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
