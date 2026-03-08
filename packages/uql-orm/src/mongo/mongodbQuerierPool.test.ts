import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AbstractQuerierPoolIt } from '../querier/abstractQuerierPool-test.js';
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
    try {
      // Stop the replica set - cleanup may throw due to timing issues in mongodb-memory-server
      await MongodbQuerierPoolIt.replSet.stop({ doCleanup: false });
    } finally {
      // Try cleanup separately to avoid "mongodProcess is still defined" error
      try {
        await MongodbQuerierPoolIt.replSet.cleanup();
      } catch {
        // Ignore cleanup errors - the process will be cleaned up by the OS
      }
    }
  }
}

createSpec(new MongodbQuerierPoolIt(new MongodbQuerierPool('mongodb://127.0.0.1:27017/test')));
