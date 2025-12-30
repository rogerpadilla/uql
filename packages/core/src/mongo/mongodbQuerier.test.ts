import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getEntities, getMeta } from '../entity/index.js';
import { AbstractQuerierIt } from '../querier/abstractQuerier-test.js';
import { createSpec } from '../test/index.js';
import type { MongodbQuerier } from './mongodbQuerier.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

class MongodbQuerierIt extends AbstractQuerierIt<MongodbQuerier> {
  static replSet: MongoMemoryReplSet;

  constructor() {
    super(new MongodbQuerierPool('mongodb://127.0.0.1:27017/test'));
  }

  override async beforeAll() {
    MongodbQuerierIt.replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = MongodbQuerierIt.replSet.getUri();
    this.pool = new MongodbQuerierPool(uri);
    await super.beforeAll();
  }

  override async afterAll() {
    await super.afterAll();
    await this.pool.end();
    await MongodbQuerierIt.replSet.stop();
  }

  override async createTables() {
    const entities = getEntities();
    await Promise.all(
      entities.map((entity) => {
        const meta = getMeta(entity);
        return this.querier.conn.db().createCollection(meta.name);
      }),
    );
  }

  override async dropTables() {
    await this.querier.conn.db().dropDatabase();
  }
}

createSpec(new MongodbQuerierIt());
