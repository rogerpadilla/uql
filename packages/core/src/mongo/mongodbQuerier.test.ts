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
    try {
      // Stop the replica set - cleanup may throw due to timing issues in mongodb-memory-server
      await MongodbQuerierIt.replSet.stop({ doCleanup: false });
    } finally {
      // Try cleanup separately to avoid "mongodProcess is still defined" error
      try {
        await MongodbQuerierIt.replSet.cleanup();
      } catch {
        // Ignore cleanup errors - the process will be cleaned up by the OS
      }
    }
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
