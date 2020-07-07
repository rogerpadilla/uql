import { User } from '../../entity/entityMock';
import { SqlQuerier } from '../sqlQuerier';
import PgQuerierPool from './pgQuerierPool';

describe(PgQuerierPool.name, () => {
  let pool: PgQuerierPool;
  let querier: SqlQuerier;

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
      const rows: { datname: string }[] = await querier.query(`SELECT datname FROM pg_database WHERE datname = 'test' LIMIT 1`);
      if (rows.length) {
        await dropTables(querier);
      } else {
        await querier.query(`CREATE DATABASE test`);
      }
      await createUserTable(querier);
      await createCompanyTable(querier);
      await createTaxCategoryTable(querier);
      await createTaxTable(querier);
    } finally {
      await querier.release();
    }
  });

  beforeEach(async () => {
    querier = await pool.getQuerier();
    jest.spyOn(querier, 'query');
    jest.spyOn(querier, 'beginTransaction');
    jest.spyOn(querier, 'commit');
    jest.spyOn(querier, 'rollback');
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
        createdAt: now.toString(),
        status: null,
        updatedAt: null,
        user: null,
      },
    ]);
    const affectedRows = await querier.updateOne(User, { id }, { status: 1 });
    expect(affectedRows).toBe(1);
  });

  async function createUserTable(querier: SqlQuerier): Promise<void> {
    await querier.query(`CREATE TABLE "user" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR( 45 ) NOT NULL,
    "email" VARCHAR( 300 ) NOT NULL,
    "password" VARCHAR( 300 ) NOT NULL,
    "createdAt" Bigint NOT NULL,
    "updatedAt" Bigint,
    "user" INT,
    "status" SmallInt
  );`);
  }

  async function createCompanyTable(querier: SqlQuerier): Promise<void> {
    await querier.query(`CREATE TABLE "Company" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR( 45 ) NOT NULL,
    "createdAt" Bigint NOT NULL,
    "updatedAt" Bigint,
    "user" INT,
    "status" SmallInt
  );`);
  }

  async function createTaxCategoryTable(querier: SqlQuerier): Promise<void> {
    await querier.query(`CREATE TABLE "TaxCategory" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR( 45 ) NOT NULL,
    "description" VARCHAR(300),
    "createdAt" Bigint NOT NULL,
    "updatedAt" Bigint,
    "user" INT,
    "company" INT NOT NULL REFERENCES "Company",
    "status" SmallInt
  );`);
  }

  async function createTaxTable(querier: SqlQuerier): Promise<void> {
    await querier.query(`CREATE TABLE "Tax" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR( 45 ) NOT NULL,
    "description" VARCHAR(300),
    "createdAt" Bigint NOT NULL,
    "updatedAt" Bigint,
    "category" INT NOT NULL REFERENCES "TaxCategory",
    "user" INT,
    "company" INT NOT NULL REFERENCES "Company",
    "status" SmallInt
  );`);
  }

  async function dropTables(querier: SqlQuerier) {
    await querier.query(`DROP TABLE IF EXISTS "Tax"`);
    await querier.query(`DROP TABLE IF EXISTS "TaxCategory"`);
    await querier.query(`DROP TABLE IF EXISTS "Company"`);
    await querier.query(`DROP TABLE IF EXISTS "User"`);
    await querier.query(`DROP TABLE IF EXISTS "user"`);
  }
});
