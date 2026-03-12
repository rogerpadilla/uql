import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { expect } from 'vitest';
import { getEntities, getMeta } from '../entity/index.js';
import { AbstractQuerierIt } from '../querier/abstractQuerier-test.js';
import { createSpec, TaxCategory } from '../test/index.js';
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
        return this.querier.conn.db().createCollection(meta.name!);
      }),
    );
  }

  override async dropTables() {
    await this.querier.conn.db().dropDatabase();
  }

  override async shouldSoftDelete() {
    return super.shouldSoftDelete();
  }

  override async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const insertResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name C' });
    expect(insertResult.changes).toBeGreaterThanOrEqual(1);
    expect(insertResult.firstId).toBeDefined();
    expect(insertResult.created).toBe(true);

    const updateResult = await this.querier.upsertOne(TaxCategory, { pk: true }, { pk, name: 'Some Name D' });
    expect(updateResult.changes).toBeGreaterThanOrEqual(1);
    expect(updateResult.firstId).toBeDefined();
    expect(updateResult.created).toBe(false);

    const record = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk } });
    expect(record).toMatchObject({ name: 'Some Name D' });
  }

  async shouldThrowOnDoubleBeginTransaction() {
    await this.querier.beginTransaction();
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    await this.querier.rollbackTransaction();
  }

  async shouldThrowOnCommitWithoutBeginTransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldThrowOnRollbackWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldThrowOnReleaseWithPendingTransaction() {
    await this.querier.beginTransaction();
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    await this.querier.rollbackTransaction();
  }
}

createSpec(new MongodbQuerierIt());
