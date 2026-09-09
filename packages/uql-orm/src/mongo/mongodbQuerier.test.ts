import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { v7 as uuidv7 } from 'uuid';
import { expect } from 'vitest';
import { Entity, Field, getEntities, getMeta, Id } from '../entity/index.js';
import { AbstractQuerierIt } from '../querier/abstractQuerier-test.js';
import { createSpec, Item, Profile, TaxCategory, User, uuidPattern } from '../test/index.js';
import type { MongodbQuerier } from './mongodbQuerier.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

/** A string key left to the driver, so MongoDB mints the `ObjectId` and the read converts it. */
@Entity()
class Ticket {
  @Id({ type: String })
  id?: string;

  @Field({ type: String })
  subject?: string;
}

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
    const existingEmail = `existing-${uuidv7()}@example.com`;
    const newEmail = `new-${uuidv7()}@example.com`;

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
   * A supplied key is the row's `_id`. It used to land under its own name beside an `_id` the driver
   * minted, so the row was written and unreachable by the value the caller held.
   */
  async shouldKeepASuppliedKey() {
    const id = await this.querier.insertOne(User, { id: 'supplied-key', name: 'supplied', createdAt: 1 });

    expect(id).toBe('supplied-key');
    expect(await this.querier.findOneById(User, 'supplied-key', { $select: { name: true } })).toMatchObject({
      name: 'supplied',
    });
  }

  /** The same for a key an `onInsert` generated - the documented portable-key pattern. */
  async shouldKeepAKeyAnOnInsertGenerated() {
    const id = await this.querier.insertOne(TaxCategory, { name: 'generated' });

    expect(String(id)).toMatch(uuidPattern);
    expect(await this.querier.findOneById(TaxCategory, id, { $select: { name: true } })).toMatchObject({
      name: 'generated',
    });
  }

  /**
   * A key the driver minted comes back as its hex string, the type the docs promise, not the
   * `ObjectId` itself - which compared unequal to its own string form.
   */
  async shouldHandBackAMintedKeyAsAHexString() {
    const id = await this.querier.insertOne(Ticket, { subject: 'minted' });

    expect(typeof id).toBe('string');
    expect(String(id)).toMatch(/^[0-9a-f]{24}$/);
    expect(await this.querier.findOneById(Ticket, id, { $select: { subject: true } })).toMatchObject({
      subject: 'minted',
    });
  }

  /**
   * A reference crosses both seams: written as the `ObjectId` the `$lookup` joins on, read back as
   * the same hex string the parent's own key reads as, so the two compare equal in code.
   */
  async shouldRoundTripAReferenceThroughTheWire() {
    const creatorId = await this.querier.insertOne(User, { name: 'creator', createdAt: 1 });
    await this.querier.insertOne(Profile, { picture: 'pic', createdAt: 1, creatorId });

    const user = await this.querier.findOneById(User, creatorId, {
      $populate: { profile: { $select: { picture: true } } },
    });
    expect(user?.profile).toMatchObject({ picture: 'pic' });

    const profile = await this.querier.findOne(Profile, { $select: { creatorId: true }, $where: { creatorId } });
    expect(profile?.creatorId).toBe(creatorId);
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
