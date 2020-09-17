import { User } from '../../entity/entityMock';
import MongodbQuerierPool from './mongodbQuerierPool';
import { MongodbQuerier } from './mongodbQuerier';

describe(MongodbQuerierPool.name, () => {
  let pool: MongodbQuerierPool;
  let querier: MongodbQuerier;

  beforeAll(async () => {
    pool = new MongodbQuerierPool({
      host: 'localhost',
      port: 27017,
      database: 'test?replicaSet=rs',
    });
    const querier = await pool.getQuerier();
    try {
      await dropCollections(querier);
      await createCollections(querier);
    } finally {
      await querier.release();
    }
  });

  beforeEach(async () => {
    querier = await pool.getQuerier();
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
    expect(1).toBe(1);
    const now = Date.now();
    const id = await querier.insertOne(User, {
      name: 'Some Name',
      email: 'someemail@example.com',
      password: '12345678!',
      createdAt: now,
    });
    expect(id).toMatch(/^[a-f\d]{24}$/i);
    const user = await querier.findOne(User, { filter: { id } });
    const users = await querier.find(User, { filter: { status: null }, limit: 100 });
    const expectedUser = {
      _id: id,
      name: 'Some Name',
      email: 'someemail@example.com',
      password: '12345678!',
      createdAt: now,
    };
    expect(user).toEqual(expectedUser);
    expect(users).toEqual([expectedUser]);
    const count1 = await querier.count(User);
    expect(count1).toBe(1);
    const count2 = await querier.count(User, { status: null });
    expect(count2).toBe(1);
    const count3 = await querier.count(User, { status: 1 });
    expect(count3).toBe(0);
    await querier.beginTransaction();
    const updatedRows = await querier.update(User, { id }, { status: 1 });
    expect(updatedRows).toBe(1);
    await querier.commitTransaction();
    const count4 = await querier.count(User, { status: 1 });
    expect(count4).toBe(1);
    const deletedRows = await querier.remove(User, { status: 1 });
    expect(deletedRows).toBe(1);
    const count5 = await querier.count(User);
    expect(count5).toBe(0);
  });

  function createCollections(querier: MongodbQuerier) {
    return Promise.all([
      querier.conn.db().createCollection('User'),
      querier.conn.db().createCollection('Company'),
      querier.conn.db().createCollection('TaxCategory'),
      querier.conn.db().createCollection('Tax'),
    ]);
  }

  function dropCollections(querier: MongodbQuerier) {
    return querier.conn.db().dropDatabase();
  }
});
