import { User } from '../../entity/entityMock';
import PgQuerierPool from './pgQuerierPool';
import { PostgresQuerier } from './postgresQuerier';

xdescribe(PgQuerierPool.name, () => {
  let pool: PgQuerierPool;
  let querier: PostgresQuerier;

  jest.setTimeout(500);

  beforeAll(async () => {
    pool = new PgQuerierPool({
      host: '0.0.0.0',
      port: 8992,
      user: 'corozo_test',
      password: 'corozo_test',
      database: 'corozo_test',
    });
    const querier = await pool.getQuerier();
    try {
      const databases: { datname: string }[] = await querier.query(`SELECT datname FROM pg_database`);
      const hasCorozoDb = databases.some((db) => db.datname === 'corozo_test');
      if (hasCorozoDb) {
        await dropTables(querier);
      } else {
        await querier.query(`CREATE DATABASE corozo_test`);
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
  });

  afterEach(async () => {
    await querier.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  // eslint-disable-next-line jest/no-focused-tests
  it('connection', () => {
    expect(querier).toBeInstanceOf(PostgresQuerier);
  });

  // eslint-disable-next-line jest/no-focused-tests
  xit('query', async () => {
    const resp = await querier.find(User, { project: { id: 1, name: 1 }, filter: { company: 123 }, limit: 100 });
    //   expect(resp).toEqual(mock);
    expect(querier.query).toBeCalledWith('SELECT `id`, `name` FROM `user` WHERE `company` = 123 LIMIT 100');
    expect(querier.query).toBeCalledTimes(1);
    expect(querier.beginTransaction).not.toBeCalled();
    expect(querier.commit).not.toBeCalled();
    expect(querier.rollback).not.toBeCalled();
    expect(querier.release).not.toBeCalled();
  });

  async function createUserTable(querier: PostgresQuerier): Promise<void> {
    await querier.query(`CREATE TABLE "User" (
    "id" SERIAL PRIMARY KEY,
    "email" VARCHAR( 300 ) NOT NULL,
    "password" VARCHAR( 300 ) NOT NULL,
    "name" VARCHAR( 45 ) NOT NULL,
    "createdAt" Bigint NOT NULL,
    "updatedAt" Bigint,
    "user" INT,
    "status" SmallInt
  );`);
  }

  async function createCompanyTable(querier: PostgresQuerier): Promise<void> {
    await querier.query(`CREATE TABLE "Company" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR( 45 ) NOT NULL,
    "createdAt" Bigint NOT NULL,
    "updatedAt" Bigint,
    "user" INT,
    "status" SmallInt
  );`);
  }

  async function createTaxCategoryTable(querier: PostgresQuerier): Promise<void> {
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

  async function createTaxTable(querier: PostgresQuerier): Promise<void> {
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

  async function dropTables(querier: PostgresQuerier) {
    await querier.query(`DROP TABLE IF EXISTS "Tax"`);
    await querier.query(`DROP TABLE IF EXISTS "TaxCategory"`);
    await querier.query(`DROP TABLE IF EXISTS "Company"`);
    await querier.query(`DROP TABLE IF EXISTS "User"`);
  }
});
