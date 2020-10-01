import { validate as validateUuidv4 } from 'uuid';
import { Company, Tax, TaxCategory, User } from 'uql/mock';
import { Querier, QuerierPool } from 'uql/type';

export abstract class QuerierSpec {
  readonly entities = [Tax, TaxCategory, Company, User] as const;
  querier: Querier;

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
    const lastId = await this.querier.insert(User, [
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
    expect(lastId).toBe(2);
  }

  async shouldQuery() {
    const users = await this.querier.find(User, {
      project: { id: 1, name: 1, email: 1, password: 1 },
    });
    expect(users).toEqual([
      {
        id: 1,
        name: 'Some Name A',
        email: 'someemaila@example.com',
        password: '123456789a!',
      },
      {
        id: 2,
        name: 'Some Name B',
        email: 'someemailb@example.com',
        password: '123456789b!',
      },
    ]);
  }

  async shouldCount() {
    const count1 = await this.querier.count(User);
    expect(count1).toBe(2);
    const count2 = await this.querier.count(User, { status: null });
    expect(count2).toBe(2);
    const count3 = await this.querier.count(User, { status: 1 });
    expect(count3).toBe(0);
  }

  async shouldInsertOne() {
    const userId = await this.querier.insertOne(User, {
      name: 'Some Name Z',
      email: 'someemailz@example.com',
      password: '123456789z!',
    });
    expect(userId).toBe(3);

    const companyId = await this.querier.insertOne(Company, {
      name: 'Some Name Z',
      user: String(userId),
    });
    expect(companyId).toBe(1);

    const taxCategoryId = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name Z',
      description: 'Some Description Z',
      user: String(userId),
      company: String(companyId),
    });
    expect(validateUuidv4(taxCategoryId)).toBe(true);
  }

  async shouldFindOne() {
    const found = await this.querier.findOne(User, {
      project: {
        name: 1,
        email: 1,
        id: 1,
        password: 1,
      },
      filter: {
        email: 'someemaila@example.com',
        status: null,
      },
    });
    expect(found).toEqual({
      name: 'Some Name A',
      email: 'someemaila@example.com',
      id: 1,
      password: '123456789a!',
    });

    const notFound = await this.querier.findOne(User, {
      filter: {
        status: 999,
      },
    });
    expect(notFound).toBeUndefined();
  }

  async shouldUpdate() {
    const updatedRows1 = await this.querier.update(User, { status: 1 }, { status: null });
    expect(updatedRows1).toBe(0);
    const updatedRows2 = await this.querier.update(User, { status: null }, { status: 1 });
    expect(updatedRows2).toBe(3);
    const updatedRows3 = await this.querier.update(User, { status: 1 }, { status: null });
    expect(updatedRows3).toBe(3);
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

  async shouldRemove() {
    await this.querier.beginTransaction();
    const deletedRows1 = await this.querier.remove(User, { status: 1 });
    expect(deletedRows1).toBe(0);
    const deletedRows2 = await this.querier.remove(User, { status: null });
    expect(deletedRows2).toBe(3);
    await this.querier.commitTransaction();
  }

  async shouldThrowWhenBeginTransactionAfterBeginTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('There is a pending transaction.');
    await expect(this.querier.release()).rejects.toThrow('There is a pending transaction.');
    await this.querier.rollbackTransaction();
  }

  async shouldThrowWhenCommitTransactionWithoutBeginTransaction() {
    await expect(async () => {
      await this.querier.commitTransaction();
    }).rejects.toThrow('There is not a pending transaction.');
  }

  async shouldThrowWhenRollbackTransactionWithoutBeginTransaction() {
    await expect(async () => {
      await this.querier.rollbackTransaction();
    }).rejects.toThrow('There is not a pending transaction.');
  }

  abstract createTables(): void;

  abstract dropTables(): void;
}
