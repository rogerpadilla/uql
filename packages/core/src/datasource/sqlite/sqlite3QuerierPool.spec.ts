import { User } from '../../entity/entityMock';
import Sqlite3QuerierPool from './sqlite3QuerierPool';
import { SqliteQuerier } from './sqliteQuerier';

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
    jest.spyOn(querier, 'query');
    jest.spyOn(querier, 'beginTransaction');
    jest.spyOn(querier, 'commitTransaction');
    jest.spyOn(querier, 'rollbackTransaction');
    jest.spyOn(querier, 'release');
  });

  afterEach(async () => {
    await querier.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('query', async () => {
    const now = Date.now();
    const id = await querier.insertOne(User, {
      name: 'Some Name',
      email: 'someemail@example.com',
      password: '12345678!',
      createdAt: now,
    });
    expect(id).toBe(1);
    const users = await querier.find(User, { filter: { status: null }, limit: 100 });
    expect(users).toEqual([
      {
        id: 1,
        name: 'Some Name',
        email: 'someemail@example.com',
        password: '12345678!',
        createdAt: now,
        status: null,
        updatedAt: null,
        user: null,
      },
    ]);
    const count1 = await querier.count(User);
    expect(count1).toBe(1);
    const count2 = await querier.count(User, { status: null });
    expect(count2).toBe(1);
    const count3 = await querier.count(User, { status: 1 });
    expect(count3).toBe(0);
    const updatedRows = await querier.update(User, { id }, { status: 1 });
    expect(updatedRows).toBe(1);
    const count4 = await querier.count(User, { status: 1 });
    expect(count4).toBe(1);
    const deletedRows = await querier.remove(User, { status: 1 });
    expect(deletedRows).toBe(1);
    const count5 = await querier.count(User);
    expect(count5).toBe(0);
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
    name VARCHAR( 45 ) NOT NULL,
    email VARCHAR( 300 ) NOT NULL,
    password VARCHAR( 300 ) NOT NULL,
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    user INT,
    status SmallInt
  );`);
  }

  function createCompanyTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE Company (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR( 45 ) NOT NULL,
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    user INT NOT NULL REFERENCES User,
    company INT NOT NULL REFERENCES Company,
    status SmallInt
  );`);
  }

  function createTaxCategoryTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE TaxCategory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR( 45 ) NOT NULL,
    description VARCHAR(300),
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    user INT NOT NULL REFERENCES User,
    company INT NOT NULL REFERENCES Company,
    status SmallInt
  );`);
  }

  function createTaxTable(querier: SqliteQuerier) {
    return querier.query(`CREATE TABLE Tax (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR( 45 ) NOT NULL,
    description VARCHAR(300),
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    category INT NOT NULL REFERENCES TaxCategory,
    user INT NOT NULL REFERENCES User,
    company INT NOT NULL REFERENCES Company,
    status SmallInt
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
