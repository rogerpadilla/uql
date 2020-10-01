import { User } from 'uql/mock';
import PgQuerierPool from './pgQuerierPool';
import { PostgresQuerier } from './postgresQuerier';

describe(PgQuerierPool.name, () => {
  let pool: PgQuerierPool;
  let querier: PostgresQuerier;

  beforeAll(async () => {
    jest.setTimeout(1000);
    pool = new PgQuerierPool({
      host: '0.0.0.0',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'test',
    });
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
    expect(id).toBe('1');
    const users = await querier.find(User, { filter: { status: null }, limit: 100 });
    expect(users).toEqual([
      {
        id: 1,
        name: 'Some Name',
        email: 'someemail@example.com',
        password: '12345678!',
        createdAt: now.toString(),
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

  async function createTables(querier: PostgresQuerier) {
    await createUserTable(querier);
    await createCompanyTable(querier);
    await createTaxCategoryTable(querier);
    await createTaxTable(querier);
  }

  async function createUserTable(querier: PostgresQuerier) {
    await querier.query(`CREATE TABLE "User" (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR( 45 ) NOT NULL,
      "email" VARCHAR( 300 ) NOT NULL,
      "password" VARCHAR( 300 ) NOT NULL,
      "createdAt" BigInt NOT NULL,
      "updatedAt" BigInt,
      "user" INT,
      "status" SmallInt
    );`);
  }

  async function createCompanyTable(querier: PostgresQuerier) {
    await querier.query(`CREATE TABLE "Company" (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR( 45 ) NOT NULL,
      "createdAt" BigInt NOT NULL,
      "updatedAt" BigInt,
      "user" INT NOT NULL REFERENCES "User",
      "status" SmallInt
    );`);
  }

  async function createTaxCategoryTable(querier: PostgresQuerier) {
    await querier.query(`CREATE TABLE "TaxCategory" (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR( 45 ) NOT NULL,
      "description" VARCHAR(300),
      "createdAt" BigInt NOT NULL,
      "updatedAt" BigInt,
      "user" INT NOT NULL REFERENCES "User",
      "company" INT NOT NULL REFERENCES "Company",
      "status" SmallInt
    );`);
  }

  async function createTaxTable(querier: PostgresQuerier) {
    await querier.query(`CREATE TABLE "Tax" (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR( 45 ) NOT NULL,
      "description" VARCHAR(300),
      "createdAt" BigInt NOT NULL,
      "updatedAt" BigInt,
      "category" INT NOT NULL REFERENCES "TaxCategory",
      "user" INT NOT NULL REFERENCES "User",
      "company" INT NOT NULL REFERENCES "Company",
      "status" SmallInt
    );`);
  }

  function dropTables(querier: PostgresQuerier) {
    return Promise.all([
      querier.query(`DROP TABLE IF EXISTS "Tax"`),
      querier.query(`DROP TABLE IF EXISTS "TaxCategory"`),
      querier.query(`DROP TABLE IF EXISTS "Company"`),
      querier.query(`DROP TABLE IF EXISTS "User"`),
    ]);
  }
});
