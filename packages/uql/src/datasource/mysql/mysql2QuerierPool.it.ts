import { User } from '../../entity/entityMock';
import MySql2QuerierPool from './mysql2QuerierPool';
import { MySqlQuerier } from './mysqlQuerier';

// eslint-disable-next-line jest/no-focused-tests
describe(MySql2QuerierPool.name, () => {
  let pool: MySql2QuerierPool;
  let querier: MySqlQuerier;

  beforeAll(async () => {
    jest.setTimeout(1000);
    pool = new MySql2QuerierPool({
      host: '0.0.0.0',
      port: 3306,
      user: 'test',
      password: 'test',
      database: 'test',
    } as any);
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

  async function createTables(querier: MySqlQuerier) {
    await createUserTable(querier);
    await createCompanyTable(querier);
    await createTaxCategoryTable(querier);
    await createTaxTable(querier);
  }

  function createUserTable(querier: MySqlQuerier) {
    return querier.query(`CREATE TABLE User (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR( 45 ) NOT NULL,
    email VARCHAR( 300 ) NOT NULL,
    password VARCHAR( 300 ) NOT NULL,
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    user INT,
    status SmallInt
  );`);
  }

  function createCompanyTable(querier: MySqlQuerier) {
    return querier.query(`CREATE TABLE Company (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR( 45 ) NOT NULL,
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    user INT NOT NULL REFERENCES User,
    status SmallInt
  );`);
  }

  function createTaxCategoryTable(querier: MySqlQuerier) {
    return querier.query(`CREATE TABLE TaxCategory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR( 45 ) NOT NULL,
    description VARCHAR(300),
    createdAt BigInt NOT NULL,
    updatedAt BigInt,
    user INT NOT NULL REFERENCES User,
    company INT NOT NULL REFERENCES Company,
    status SmallInt
  );`);
  }

  function createTaxTable(querier: MySqlQuerier) {
    return querier.query(`CREATE TABLE Tax (
    id INT AUTO_INCREMENT PRIMARY KEY,
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

  function dropTables(querier: MySqlQuerier) {
    return Promise.all([
      querier.query(`DROP TABLE IF EXISTS Tax`),
      querier.query(`DROP TABLE IF EXISTS TaxCategory`),
      querier.query(`DROP TABLE IF EXISTS Company`),
      querier.query(`DROP TABLE IF EXISTS User`),
    ]);
  }
});
