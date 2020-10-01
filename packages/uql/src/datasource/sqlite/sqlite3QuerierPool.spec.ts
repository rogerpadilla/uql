import { validate as validateUuidv4 } from 'uuid';
import { Company, TaxCategory, User } from 'uql/mock';
import { SqliteQuerier } from './sqliteQuerier';
import Sqlite3QuerierPool from './sqlite3QuerierPool';

describe(Sqlite3QuerierPool.name, () => {
  let pool: Sqlite3QuerierPool;
  let querier: SqliteQuerier;

  beforeAll(async () => {
    pool = new Sqlite3QuerierPool(':memory:');
    const querier = await pool.getQuerier();
    try {
      await dropTables(querier);
      await createTables(querier);
    } finally {
      await querier.release();
    }
  });

  beforeEach(async () => {
    querier = await pool.getQuerier();
  });

  afterEach(async () => {
    await querier.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('insert', async () => {
    const lastId = await querier.insert(User, [
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
  });

  it('query', async () => {
    const users = await querier.find(User, {
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
  });

  it('count', async () => {
    const count1 = await querier.count(User);
    expect(count1).toBe(2);
    const count2 = await querier.count(User, { status: null });
    expect(count2).toBe(2);
    const count3 = await querier.count(User, { status: 1 });
    expect(count3).toBe(0);
  });

  it('insertOne', async () => {
    const userId = await querier.insertOne(User, {
      name: 'Some Name Z',
      email: 'someemailz@example.com',
      password: '123456789z!',
    });
    expect(userId).toBe(3);

    const companyId = await querier.insertOne(Company, {
      name: 'Some Name Z',
      user: String(userId),
    });
    expect(companyId).toBe(1);

    const taxCategoryId = await querier.insertOne(TaxCategory, {
      name: 'Some Name Z',
      description: 'Some Description Z',
      user: String(userId),
      company: String(companyId),
    });
    expect(validateUuidv4(taxCategoryId)).toBe(true);
  });

  it('findOne', async () => {
    const found = await querier.findOne(User, {
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

    const notFound = await querier.findOne(User, {
      filter: {
        status: 999,
      },
    });
    expect(notFound).toBeUndefined();
  });

  it('update', async () => {
    const updatedRows1 = await querier.update(User, { status: 1 }, { status: null });
    expect(updatedRows1).toBe(0);
    const updatedRows2 = await querier.update(User, { status: null }, { status: 1 });
    expect(updatedRows2).toBe(3);
    const updatedRows3 = await querier.update(User, { status: 1 }, { status: null });
    expect(updatedRows3).toBe(3);
  });

  it('rollback', async () => {
    const count1 = await querier.count(User);
    expect(count1).toBe(3);
    await querier.beginTransaction();
    const count2 = await querier.count(User);
    expect(count2).toBe(count1);
    const deletedRows1 = await querier.remove(User, { status: null });
    expect(deletedRows1).toBe(count1);
    const deletedRows2 = await querier.remove(User, { status: null });
    expect(deletedRows2).toBe(0);
    const count3 = await querier.count(User);
    expect(count3).toBe(0);
    await querier.rollbackTransaction();
    const count4 = await querier.count(User);
    expect(count4).toBe(count1);
  });

  it('remove', async () => {
    await querier.beginTransaction();
    const deletedRows1 = await querier.remove(User, { status: 1 });
    expect(deletedRows1).toBe(0);
    const deletedRows2 = await querier.remove(User, { status: null });
    expect(deletedRows2).toBe(3);
    await querier.commitTransaction();
  });

  it('beginTransaction after beginTransaction', async () => {
    expect(querier.hasOpenTransaction).toBeFalsy();
    await querier.beginTransaction();
    expect(querier.hasOpenTransaction).toBe(true);
    await expect(querier.beginTransaction()).rejects.toThrow('There is a pending transaction.');
    await expect(querier.release()).rejects.toThrow('There is a pending transaction.');
    await querier.rollbackTransaction();
  });

  it('commitTransaction without beginTransaction', async () => {
    await expect(async () => {
      await querier.commitTransaction();
    }).rejects.toThrow('There is not a pending transaction.');
  });

  it('rollbackTransaction without beginTransaction', async () => {
    await expect(async () => {
      await querier.rollbackTransaction();
    }).rejects.toThrow('There is not a pending transaction.');
  });

  async function createTables(querier: SqliteQuerier) {
    await createUserTable(querier);
    await createCompanyTable(querier);
    await createTaxCategoryTable(querier);
    await createTaxTable(querier);
  }

  function createUserTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE User (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(45) NOT NULL,
      email VARCHAR( 300 ) NOT NULL,
      password VARCHAR( 300 ) NOT NULL,
      createdAt BIGINT NOT NULL,
      updatedAt BIGINT,
      user INT,
      status SMALLINT
    );`);
  }

  function createCompanyTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE Company (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(45) NOT NULL,
      createdAt BIGINT NOT NULL,
      updatedAt BIGINT,
      user INT NOT NULL REFERENCES User,
      company INT REFERENCES Company,
      status SMALLINT
    );`);
  }

  function createTaxCategoryTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE TaxCategory (
      pk VARCHAR(40) PRIMARY KEY,
      name VARCHAR(45) NOT NULL,
      description VARCHAR(300),
      createdAt BIGINT NOT NULL,
      updatedAt BIGINT,
      user INT NOT NULL REFERENCES User,
      company INT NOT NULL REFERENCES Company,
      status SMALLINT
    );`);
  }

  function createTaxTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE Tax (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(45) NOT NULL,
      description VARCHAR(300),
      createdAt BIGINT NOT NULL,
      updatedAt BIGINT,
      category INT NOT NULL REFERENCES TaxCategory,
      user INT NOT NULL REFERENCES User,
      company INT NOT NULL REFERENCES Company,
      status SMALLINT
    );`);
  }

  function dropTables(querier: SqliteQuerier) {
    return Promise.all([
      querier.query(`DROP TABLE IF EXISTS Tax`),
      querier.query(`DROP TABLE IF EXISTS TaxCategory`),
      querier.query(`DROP TABLE IF EXISTS Company`),
      querier.query(`DROP TABLE IF EXISTS User`),
    ]);
  }
});
