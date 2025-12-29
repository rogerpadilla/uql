import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AbstractQuerierPoolIt } from '../querier/abstractQuerierPool-it.js';
import { createSpec } from '../test/index.js';
import type { MongodbQuerier } from './mongodbQuerier.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

class MongodbQuerierPoolIt extends AbstractQuerierPoolIt<MongodbQuerier> {
  static replSet: MongoMemoryReplSet;

  async beforeAll() {
    MongodbQuerierPoolIt.replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = MongodbQuerierPoolIt.replSet.getUri();
    this.pool = new MongodbQuerierPool(uri);
  }

  override async afterAll() {
    await super.afterAll();
    await this.pool.end();
    await MongodbQuerierPoolIt.replSet.stop();
  }
}

createSpec(new MongodbQuerierPoolIt(new MongodbQuerierPool('mongodb://127.0.0.1:27017/test')));
