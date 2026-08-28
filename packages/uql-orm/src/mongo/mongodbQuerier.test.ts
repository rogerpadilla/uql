import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { expect } from 'vitest';
import { getEntities, getMeta } from '../entity/index.js';
import { AbstractQuerierIt } from '../querier/abstractQuerier-test.js';
import { createSpec, Item, TaxCategory, User } from '../test/index.js';
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

  /**
   * `$text` against a real text index, which is what makes MongoDB's full-text search work: the index
   * declares the fields, so `$fields` is accepted for API consistency and ignored (as `$distance` is).
   * Before this, `$text` never reached MongoDB at all - path validation rejected it as a field name.
   */
  async shouldFindByTextSearch() {
    await this.querier.conn.db().collection('Item').createIndex({ name: 'text', description: 'text' });
    await this.querier.insertMany(Item, [
      { name: 'red bicycle', description: 'a fast one' },
      { name: 'blue hammer', description: 'a heavy tool' },
    ]);

    const found = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { $text: { $fields: ['name'], $value: 'bicycle' } },
    });

    expect(found.map(({ name }) => name)).toEqual(['red bicycle']);
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

  async shouldIgnoreRollbackWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).resolves.toBeUndefined();
    expect(this.querier.hasOpenTransaction).toBe(false);
  }

  async shouldRollBackOnReleaseWithPendingTransaction() {
    await this.querier.beginTransaction();
    await expect(this.querier.release()).resolves.toBeUndefined();
    expect(this.querier.hasOpenTransaction).toBe(false);
  }

  async shouldUpsertManyReturnGeneratedIdsOnlyForInsertedDocs() {
    // Conflict path is `email`, not `_id` - so a newly-inserted document's `_id` is
    // MongoDB-generated and unknown to the caller ahead of time.
    const existingEmail = `existing-${randomUUID()}@example.com`;
    const newEmail = `new-${randomUUID()}@example.com`;

    await this.querier.insertOne(User, { name: 'Existing', email: existingEmail, createdAt: 1 });

    const result = await this.querier.upsertMany(User, { email: true }, [
      { name: 'New', email: newEmail, createdAt: 2 },
      { name: 'Existing Updated', email: existingEmail, createdAt: 3 },
    ]);

    expect(result.changes).toBeGreaterThanOrEqual(2);
    // Only the inserted document's id is knowable from `bulkWrite`'s response - the updated
    // document's `_id` isn't returned, so it must not appear here.
    expect(result.ids).toHaveLength(1);
    expect(result.firstId).toBe(result.ids?.[0]);

    const inserted = await this.querier.findOne(User, { $select: { id: true }, $where: { email: newEmail } });
    expect(inserted).toBeDefined();
    expect(String(result.firstId)).toBe(String(inserted!.id));
  }

  /**
   * Pins a divergence rather than endorsing it. The SQL backends settle a write's rows with a
   * `SELECT`, so `$sort`/`$limit` pick which rows it touches; MongoDB resolves ids from `$where`
   * alone and both clauses fall on the floor, so a write meant for one row hits every match. Left
   * as-is here because it predates the vector-sort work, but the day it is fixed this test is what
   * says so out loud instead of the behaviour changing unnoticed.
   */
  async shouldIgnoreSortAndLimitOnAnUpdate() {
    await this.querier.insertMany(User, [
      { name: 'Charlie', createdAt: 3 },
      { name: 'Alice', createdAt: 1 },
      { name: 'Bob', createdAt: 2 },
    ]);

    const changes = await this.querier.updateMany(User, { $sort: { createdAt: 1 }, $limit: 1 }, { name: 'Touched' });

    expect(changes).toBe(3);
    const found = await this.querier.findMany(User, { $select: { name: true } });
    expect(found.map(({ name }) => name)).toEqual(['Touched', 'Touched', 'Touched']);
  }

  async shouldIgnoreSortAndLimitOnADelete() {
    await this.querier.insertMany(User, [
      { name: 'Charlie', createdAt: 3 },
      { name: 'Alice', createdAt: 1 },
      { name: 'Bob', createdAt: 2 },
    ]);

    const changes = await this.querier.deleteMany(User, { $sort: { createdAt: 1 }, $limit: 1 });

    expect(changes).toBe(3);
    const found = await this.querier.findMany(User, { $select: { name: true } });
    expect(found).toHaveLength(0);
  }

  async shouldFindManyWithSortAndLimit() {
    await this.querier.insertMany(User, [
      { name: 'Charlie', createdAt: 3 },
      { name: 'Alice', createdAt: 1 },
      { name: 'Bob', createdAt: 2 },
    ]);

    const res = await this.querier.findMany(User, {
      $sort: { name: 1 },
      $skip: 1,
      $limit: 1,
    });

    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Bob');
  }
}

createSpec(new MongodbQuerierIt());
