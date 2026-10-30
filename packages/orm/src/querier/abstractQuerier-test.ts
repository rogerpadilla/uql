import { expect } from 'vitest';
import { withContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import {
  anyUuid,
  assertDefined,
  Company,
  Carrier,
  Label,
  Parcel,
  Shipment,
  ShipmentLabel,
  JsonHolder,
  JsonRecord,
  JsonValue,
  LooseDoc,
  Reading,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  ItemTag,
  LedgerAccount,
  MeasureUnit,
  MeasureUnitCategory,
  Profile,
  Reply,
  type Spec,
  type SpecRequirements,
  Tag,
  Tax,
  TaxCategory,
  TenantNote,
  TypedRow,
  User,
  VectorChunk,
  VectorCitation,
  VectorDoc,
  VersionedNote,
  WideVersionedNote,
} from '../test/index.js';
import type {
  CursorPage,
  JsonUpdateOp,
  Querier,
  QuerierPool,
  Query,
  QueryKeyset,
  QuerySearch,
  QueryWhere,
  Type,
} from '../type/index.js';
import { refs, withDeleted } from '../util/index.js';
import { UqlOptimisticLockError, UqlUsageError } from '../util/uqlError.js';
import { queryErrorKind } from './queryError.js';

const thrownValue = (thrown: unknown) => thrown;
const asTenant = <T>(tenantId: string, fn: () => Promise<T>) => withContext({ tenantId }, fn);
const asSystem = <T>(fn: () => Promise<T>) => withContext({ system: true }, fn);

/** The rows a find matched are those each tally counted, by id. */
const expectSameRows = (rows: readonly { id?: unknown }[], tallies: readonly { id?: unknown; n: number }[]) => {
  const ids = (it: readonly { id?: unknown }[]) => it.map(({ id }) => String(id)).sort();
  expect(ids(tallies.filter(({ n }) => n > 0))).toEqual(ids(rows));
};

export abstract class AbstractQuerierIt<
  Q extends Querier,
  D extends AbstractDialect = AbstractDialect,
> implements Spec {
  querier!: Q;

  constructor(protected pool: QuerierPool<Q, D>) {}

  requirements(): SpecRequirements<this> {
    return { shouldRefuseALockTheEngineLacks: !this.pool.dialect.features.rowLocks };
  }

  async beforeAll() {
    await this.pool.withQuerier((querier) => this.recreateTables(querier));
  }

  async beforeEach() {
    this.querier = await this.pool.getQuerier();
    await this.clearTables();
  }

  async afterEach() {
    await this.querier.release();
  }

  async afterAll() {
    await this.pool.end();
  }

  /** Every fixture table, empty, whatever an earlier run left behind. */
  abstract recreateTables(querier: Q): Promise<void>;

  /** Every fixture table emptied, through `this.querier`. */
  abstract clearTables(): Promise<void>;

  /** `await using` releases on any backend, through `Symbol.asyncDispose` every querier inherits. */
  async shouldReleaseOnAsyncDispose() {
    const querier = await this.pool.getQuerier();

    {
      await using scoped = querier;
      await scoped.count(User);
    }

    await expect(querier.count(User)).rejects.toThrow('querier already released');
  }

  /** The release still happens when the block exits through a throw. */
  async shouldReleaseOnAsyncDisposeWhenBodyThrows() {
    const querier = await this.pool.getQuerier();

    await expect(
      (async () => {
        await using scoped = querier;
        await scoped.count(User);
        throw new TypeError('boom');
      })(),
    ).rejects.toThrow('boom');

    await expect(querier.count(User)).rejects.toThrow('querier already released');
  }

  /**
   * Releasing with a transaction open rolls it back and hands the connection over, rather than throwing
   * and losing both the caller's error and the connection: the write is gone from the next unit of work.
   */
  async shouldRollBackAnOpenTransactionOnRelease() {
    const querier = await this.pool.getQuerier();
    await querier.beginTransaction();
    await querier.insertOne(User, { name: 'Rolled Back', email: 'rolledback@example.com' });
    await expect(querier.release()).resolves.toBeUndefined();

    await expect(this.pool.count(User, { $where: { email: 'rolledback@example.com' } })).resolves.toBe(0);
  }

  /**
   * The same, through `await using`: the real error reaches the caller unwrapped, where a throwing dispose
   * would hand it a SuppressedError with an empty message.
   */
  async shouldRollBackAnOpenTransactionOnAsyncDispose() {
    const querier = await this.pool.getQuerier();
    await expect(
      querier.transaction(async () => {
        await using scoped = querier;
        await scoped.insertOne(User, { name: 'Disposed', email: 'disposed@example.com' });
        throw new TypeError('the real failure');
      }),
    ).rejects.toThrow('the real failure');

    await expect(this.pool.count(User, { $where: { email: 'disposed@example.com' } })).resolves.toBe(0);
  }

  /** On every backend, as the caller's mistake: a `usage` error, which a transport answers with a 400. */
  async shouldRefuseToWorkAfterBeingReleased() {
    const querier = await this.pool.getQuerier();
    await querier.release();

    await expect(querier.count(User)).rejects.toThrow('querier already released');
    expect(queryErrorKind(await querier.count(User).catch(thrownValue))).toBe('usage');
  }

  /** Each pool call is its own acquire/run/release, which is why the read below sees the write above. */
  async shouldRunOperationsOnThePool() {
    const id = await this.pool.insertOne(User, {
      name: 'Pool Write',
      email: 'poolwrite@example.com',
      password: '123456789p!',
    });

    const updated = await this.pool.updateMany(User, { $where: { id } }, { name: 'Pool Write Renamed' });
    expect(updated).toBe(1);

    const found = await this.pool.findOneById(User, id, { $select: { name: true } });
    expect(found).toEqual({ name: 'Pool Write Renamed' });

    expect(await this.pool.deleteMany(User, { $where: { id } })).toBe(1);
    expect(await this.pool.count(User, { $where: { id } })).toBe(0);
  }

  /**
   * The one pool call whose connection outlives the call itself: it is held until the loop ends, and given
   * back then, so the pool still hands one out.
   */
  async shouldStreamFromThePool() {
    await this.pool.insertMany(User, [
      { name: 'Stream A', email: 'streama@example.com', password: '123456789a!' },
      { name: 'Stream B', email: 'streamb@example.com', password: '123456789b!' },
    ]);

    const rows = await Array.fromAsync(this.pool.findManyStream(User, { $select: { name: true }, $sort: { name: 1 } }));

    expect(rows.map(({ name }) => name)).toEqual(['Stream A', 'Stream B']);
    expect(await this.pool.count(User)).toBe(2);
  }

  async shouldInsertMany() {
    const ids = await this.querier.insertMany(User, [
      {
        name: 'Some Name A',
        email: 'someemaila@example.com',
        password: '123456789a!',
      },
      {
        name: 'Some Name B',
        email: 'someemailb@example.com',
        password: '123456789b!',
      },
    ]);
    expect(ids).toEqual([anyUuid, anyUuid]);
  }

  async shouldInsertManyEmpty() {
    const ids = await this.querier.insertMany(User, []);
    expect(ids).toEqual([]);
  }

  /**
   * The lost update the version exists to stop: two writers read the same row and both write it. The
   * first wins, the second finds its version gone and throws rather than overwriting the first.
   */
  async shouldRefuseAStaleVersion() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'first' });

    expect(await this.querier.updateOneById(VersionedNote, id, { title: 'winner', version: 0 })).toBe(1);

    const err = await this.querier.updateOneById(VersionedNote, id, { title: 'loser', version: 0 }).catch(thrownValue);
    expect(err).toBeInstanceOf(UqlOptimisticLockError);
    expect(err).toMatchObject({ expected: 0, actual: 1 });
    expect(queryErrorKind(err)).toBe('optimisticLock');
    expect(await this.querier.findOneById(VersionedNote, id, { $select: { title: true, version: true } })).toEqual({
      title: 'winner',
      version: 1,
    });
  }

  /** Two queriers writing at once: the same rule holds across connections, which is where it matters. */
  async shouldLetOnlyOneOfTwoWritersWin() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'contested' });
    const other = await this.pool.getQuerier();
    try {
      const results = await Promise.allSettled([
        this.querier.updateOneById(VersionedNote, id, { title: 'a', version: 0 }),
        other.updateOneById(VersionedNote, id, { title: 'b', version: 0 }),
      ]);
      const lost = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(results).toHaveLength(2);
      expect(lost).toHaveLength(1);
      expect(queryErrorKind(lost[0].reason)).toBe('optimisticLock');
    } finally {
      await other.release();
    }
    expect((await this.querier.findOneById(VersionedNote, id))?.version).toBe(1);
  }

  /** A `BigInt` version bumps as exactly as it reads, whatever the driver answers a BIGINT with. */
  async shouldBumpAWideVersion() {
    const id = await this.querier.insertOne(WideVersionedNote, { title: 'wide' });

    expect(await this.querier.updateOneById(WideVersionedNote, id, { title: 'bumped', version: 0n })).toBe(1);
    expect(await this.querier.findOneById(WideVersionedNote, id, { $select: { version: true } })).toEqual({
      version: 1n,
    });
  }

  /** Each of the three ways an update matches nothing reads as itself, which is what the caller acts on. */
  async shouldTellAGoneRowFromAMovedOne() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'doomed' });

    const excluded = await this.querier
      .updateMany(VersionedNote, { $where: { id, title: 'wrong' } }, { title: 'x', version: 0 })
      .catch(thrownValue);
    expect(excluded).toMatchObject({ expected: 0, actual: 0, message: expect.stringContaining('excluded it') });

    await this.querier.deleteOneById(VersionedNote, id, { hardDelete: true });
    const gone = await this.querier.updateOneById(VersionedNote, id, { title: 'ghost', version: 0 }).catch(thrownValue);
    expect(queryErrorKind(gone)).toBe('optimisticLock');
    expect(gone).toMatchObject({ expected: 0, actual: undefined });
  }

  /** `returning` keeps the lock's word: a gone versioned row throws, as it does without it. */
  async shouldTellAGoneRowWhenReturning() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'doomed' });
    await this.querier.deleteOneById(VersionedNote, id, { hardDelete: true });

    const gone = await this.querier
      .updateOneById(VersionedNote, id, { title: 'ghost', version: 0 }, { returning: { title: true } })
      .catch(thrownValue);

    expect(gone).toMatchObject({ expected: 0, actual: undefined });
  }

  /** One version cannot speak for many rows, so a versioned update is named by its id or refused. */
  async shouldRefuseAVersionedUpdateNamingMoreThanOneRow() {
    await this.querier.insertOne(VersionedNote, { title: 'batch' });
    await this.querier.insertOne(VersionedNote, { title: 'batch' });

    await expect(
      this.querier.updateMany(VersionedNote, { $where: { title: 'batch' } }, { title: 'done', version: 0 }),
    ).rejects.toThrow("cannot update 'VersionedNote' this way");
  }

  /** Delete and restore move the row's lifecycle, not its content, so neither carries a version. */
  async shouldDeleteAndRestoreAVersionedRowWithoutItsVersion() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'archived' });

    expect(await this.querier.deleteOneById(VersionedNote, id)).toBe(1);
    expect(await this.querier.restoreOneById(VersionedNote, id)).toBe(1);
    expect((await this.querier.findOneById(VersionedNote, id))?.version).toBe(0);
    expect(await this.querier.deleteOneById(VersionedNote, id, { hardDelete: true })).toBe(1);
  }

  /** An upsert inserts an absent versioned row, and updates a found one only at the version it carries. */
  async shouldUpsertAVersionedRowAtItsVersion() {
    const id = await this.querier.upsertOne(VersionedNote, { $conflict: { id: true } }, { title: 'first' });
    expect(await this.querier.findOneById(VersionedNote, id, { $select: { title: true, version: true } })).toEqual({
      title: 'first',
      version: 0,
    });

    await this.querier.upsertOne(VersionedNote, { $conflict: { id: true } }, { id, title: 'second', version: 0 });
    const stale = await this.querier
      .upsertOne(VersionedNote, { $conflict: { id: true } }, { id, title: 'stale', version: 0 })
      .catch(thrownValue);

    expect(stale).toBeInstanceOf(UqlOptimisticLockError);
    expect(stale).toMatchObject({ expected: 0, actual: 1 });
    expect(await this.querier.findOneById(VersionedNote, id, { $select: { title: true, version: true } })).toEqual({
      title: 'second',
      version: 1,
    });
  }

  /** A save writes a found versioned row as an update does, so a stale copy throws rather than overwriting it. */
  async shouldSaveAVersionedRowAtItsVersion() {
    const id = await this.querier.saveOne(VersionedNote, { title: 'draft' });

    await this.querier.saveOne(VersionedNote, { id, title: 'published', version: 0 });
    const stale = await this.querier.saveOne(VersionedNote, { id, title: 'stale', version: 0 }).catch(thrownValue);

    expect(queryErrorKind(stale)).toBe('optimisticLock');
    expect(await this.querier.findOneById(VersionedNote, id, { $select: { title: true, version: true } })).toEqual({
      title: 'published',
      version: 1,
    });
  }

  /** A uuid reads back as it was written, which matching a read row to its payload by key relies on. */
  async shouldReadAUuidBackAsWritten() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'keyed' });

    expect(await this.querier.findOneById(VersionedNote, id, { $select: { id: true } })).toEqual({ id });
  }

  /** A found versioned row is written against its version, so an upsert that carries none says so. */
  async shouldRefuseAVersionedUpsertCarryingNoVersion() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'kept' });

    await expect(
      this.querier.upsertOne(VersionedNote, { $conflict: { id: true } }, { id, title: 'unversioned' }),
    ).rejects.toThrow("an update of 'VersionedNote' carries no 'version'");
  }

  /** A row leaving its conflict key to the database conflicts with none, so it inserts and reports as an insert does. */
  async shouldUpsertRowsLeavingTheirKeyToTheDatabase() {
    const rows = await this.querier.upsertMany(User, { $conflict: { id: true } }, [{ name: 'a' }, { name: 'b' }], {
      returning: { name: true },
    });

    expect(rows).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(await this.querier.count(User)).toBe(2);
  }

  /** A found versioned row its `$where` excludes stays as it is, as an unversioned one does: no lock error. */
  async shouldKeepAVersionedRowAnUpsertsWhereExcludes() {
    const id = await this.querier.insertOne(VersionedNote, { title: 'kept' });

    await this.querier.upsertOne(
      VersionedNote,
      { $conflict: { id: true }, $where: { title: 'other' } },
      { id, title: 'changed', version: 0 },
    );

    expect(await this.querier.findOneById(VersionedNote, id, { $select: { title: true, version: true } })).toEqual({
      title: 'kept',
      version: 0,
    });
  }

  /** The driver's own error, read as it reaches the caller, on every backend MongoDB included. */
  async shouldNameAUniqueViolation() {
    const id = await this.querier.insertOne(User, { name: 'first' });
    const err = await this.querier.insertOne(User, { id, name: 'second' }).catch(thrownValue);
    expect(queryErrorKind(err)).toBe('uniqueViolation');
  }

  async shouldInsertOne() {
    const creatorId = await this.querier.insertOne(User, {
      name: 'Some Name C',
      email: 'someemailc@example.com',
      password: '123456789z!',
    });

    const companyId = await this.querier.insertOne(Company, {
      name: 'Some Name C',
      creatorId,
    });

    const taxCategoryId = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name C',
      description: 'Some Description Z',
      creatorId,
      companyId,
    });
    expect(
      await this.querier.findOneById(TaxCategory, taxCategoryId, { $select: { creatorId: true, companyId: true } }),
    ).toEqual({ creatorId, companyId });
  }

  /** A supplied key is the row's own, and an `onInsert` one fills a key left out: each names the row written. */
  async shouldKeepASuppliedKeyAndGenerateAMissingOne() {
    const supplied = await this.querier.insertOne(TaxCategory, { pk: '123', name: 'supplied' });
    const generated = await this.querier.insertOne(TaxCategory, { name: 'generated' });

    expect([supplied, generated]).toEqual(['123', anyUuid]);
    expect(await this.taxCategoryNames(supplied, generated)).toEqual(['generated', 'supplied']);
  }

  async shouldInsertManyWithSpecifiedIdsAndOnInsertIdAsDefault() {
    const ids = await this.querier.insertMany(TaxCategory, [
      {
        name: 'Some Name A',
      },
      {
        pk: '50',
        name: 'Some Name B',
      },
      {
        name: 'Some Name C',
      },
      {
        pk: '70',
        name: 'Some Name D',
      },
    ]);
    expect(ids).toEqual([anyUuid, '50', anyUuid, '70']);
  }

  async shouldInsertManyWithHeterogeneousFieldSets() {
    const ids = await this.querier.insertMany(User, [
      { name: 'Het A', email: 'heta@example.com', password: '123456789a!' },
      { name: 'Het B' },
    ]);
    expect(ids).toEqual([anyUuid, anyUuid]);
    const founds = await this.querier.findMany(User, {
      $select: { name: true, email: true },
      $where: { name: ['Het A', 'Het B'] },
      $sort: { name: 1 },
    });
    expect(founds).toHaveLength(2);
    expect(founds[0]).toEqual({ name: 'Het A', email: 'heta@example.com' });
    expect(founds[1].name).toBe('Het B');
    // The missing column falls back to its database default: SQL surfaces it as null, Mongo omits
    // the field (undefined). Either way it is nullish, never a value bleed from the sibling record.
    expect(founds[1].email == null).toBe(true);
  }

  async shouldInsertOneAndCascadeOneToOne() {
    const payload = {
      name: 'Some Name D',
      createdAt: 123,
      profile: { picture: 'abc', createdAt: 123 },
    } satisfies User;
    const id = await this.querier.insertOne(User, payload);
    const found = await this.querier.findOneById(User, id, { $populate: { profile: true } });
    expect(found).toMatchObject({ id, profile: payload.profile });
  }

  async shouldInsertOneAndCascadeManyToOne() {
    const payload = {
      name: 'Centimeter',
      createdAt: 123,
      category: { name: 'Metric', createdAt: 123 },
    } satisfies MeasureUnit;

    const id = await this.querier.insertOne(MeasureUnit, payload);

    const found = await this.querier.findOneById(MeasureUnit, id, { $populate: { category: true } });

    expect(found).toMatchObject({ id, category: payload.category });
  }

  /** Written together, each parent still points at its own referenced row. */
  async shouldInsertManyAndCascadeManyToOnePerParent() {
    await this.querier.insertMany(MeasureUnit, [
      { name: 'Meter', category: { name: 'Length' } },
      { name: 'Gram', category: { name: 'Mass' } },
    ]);

    const found = await this.querier.findMany(MeasureUnit, {
      $select: { name: true },
      $sort: { name: 1 },
      $populate: { category: { $select: { name: true } } },
    });

    expect(found.map(({ name, category }) => [name, category?.name])).toEqual([
      ['Gram', 'Mass'],
      ['Meter', 'Length'],
    ]);
  }

  /** Written together, each parent links its own copies of the rows it lists. */
  async shouldInsertManyAndCascadeManyToManyPerParent() {
    await this.querier.insertMany(Item, [
      { name: 'first', tags: [{ name: 'a' }, { name: 'b' }] },
      { name: 'second', tags: [{ name: 'c' }] },
    ]);

    const found = await this.querier.findMany(Item, {
      $select: { name: true },
      $sort: { name: 1 },
      $populate: { tags: { $select: { name: true }, $sort: { name: 1 } } },
    });

    expect(found.map(({ name, tags }) => [name, tags.map((tag) => tag.name)])).toEqual([
      ['first', ['a', 'b']],
      ['second', ['c']],
    ]);
    await expect(this.querier.count(Tag, {})).resolves.toBe(3);
  }

  async shouldInsertSpecialChars() {
    const payload: MeasureUnit = {
      name: `I'm Cielo! How are you doing today? It's been a while since we last talked`,
      createdAt: 123,
    };

    const id = await this.querier.insertOne(MeasureUnit, payload);

    const found = await this.querier.findOneById(MeasureUnit, id);

    expect(found).toMatchObject(payload);
  }

  async shouldInsertOneAndCascadeOneToMany() {
    const id = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      date: new Date(),
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });

    expect(await this.adjustmentPrices(id)).toEqual([50, 300]);
  }

  /** A `$select` naming fields only to drop them leaves every one out and reads the rest. */
  async shouldLeaveOutEveryFieldAFalsySelectNames() {
    await this.querier.insertOne(User, { name: 'Ann', email: 'ann@subtractive.com' });

    const [user] = await this.querier.findMany(User, {
      $select: { name: false, email: false },
      $where: { email: 'ann@subtractive.com' },
    });

    assertDefined(user);
    expect(user).not.toHaveProperty('name');
    expect(user).not.toHaveProperty('email');
    expect(user).toHaveProperty('id');
  }

  async shouldUpdateOneAndCascadeOneToMany() {
    const id = await this.querier.insertOne(InventoryAdjustment, { description: 'some description' });

    const changes = await this.querier.updateOneById(InventoryAdjustment, id, {
      itemAdjustments: [{ buyPrice: 50 }, { buyPrice: 300 }],
    });

    expect(changes).toBe(1);
    expect(await this.adjustmentPrices(id)).toEqual([50, 300]);
  }

  /**
   * The row's type says a populated to-many is a list, so the runtime has to hand back one even for a
   * parent with no children. An *unpopulated* relation stays absent, which is what tells the two apart.
   */
  async shouldPopulateAToManyWithNoChildrenAsAnEmptyList() {
    await this.querier.insertOne(InventoryAdjustment, { description: 'childless' });

    const [found] = await this.querier.findMany(InventoryAdjustment, {
      $where: { description: 'childless' },
      $populate: { itemAdjustments: true },
    });

    expect(found.itemAdjustments).toEqual([]);

    const [unpopulated] = await this.querier.findMany(InventoryAdjustment, {
      $where: { description: 'childless' },
    });

    expect('itemAdjustments' in unpopulated).toBe(false);
  }

  /** A reference stored under its relation's name reads back as its key and, populated, as the related row. */
  async shouldPopulateARelationStoredUnderItsOwnName() {
    const [ada, linus] = await this.querier.insertMany(User, [{ name: 'Ada' }, { name: 'Linus' }]);
    await this.querier.insertMany(Reply, [
      { text: 'first', authorId: ada },
      { text: 'second', authorId: linus },
    ]);

    const replies = await this.querier.findMany(Reply, {
      $select: { text: true, authorId: true },
      $populate: { author: { $select: { name: true } } },
      $where: { author: { name: 'Ada' } },
      $sort: { author: { name: 'asc' } },
    });

    expect(replies).toEqual([{ text: 'first', authorId: ada, author: { id: ada, name: 'Ada' } }]);
  }

  /** A relation stored under its own name populates without its reference where the query leaves that out. */
  async shouldPopulateARelationStoredUnderItsOwnNameAlone() {
    const ada = await this.querier.insertOne(User, { name: 'Ada' });
    await this.querier.insertOne(Reply, { text: 'only', authorId: ada });

    const replies = await this.querier.findMany(Reply, {
      $select: { text: true },
      $populate: { author: { $select: { name: true } } },
    });

    expect(replies).toEqual([{ text: 'only', author: { id: ada, name: 'Ada' } }]);
  }

  /**
   * The other half of the asymmetry: a to-one joins with a LEFT JOIN, so populating one whose key is
   * null leaves it absent rather than empty. That is why a populated to-one stays optional in the
   * row's type where a to-many does not.
   */
  async shouldPopulateAToOneWithNoRowAsAbsent() {
    await this.querier.insertOne(Item, { name: 'untaxed' });

    const [found] = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { name: 'untaxed' },
      $populate: { tax: true },
    });

    expect(found.tax == null).toBe(true);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    const id = await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(2);

    await this.querier.updateOneById(InventoryAdjustment, id, {
      itemAdjustments: null,
    });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(0);
  }

  /**
   * The rows an `updateMany` settles all take the same relation payload, so the cascade runs per
   * relation rather than per row. Asserted here rather than only where the statements are counted:
   * that spec is SQL-only, and the code deciding it is the shared querier both backends inherit.
   */
  async shouldUpdateManyAndCascadeOneToManyOverEveryMatchedRow() {
    const first = await this.querier.insertOne(InventoryAdjustment, { description: 'batch', itemAdjustments: [{}] });
    const second = await this.querier.insertOne(InventoryAdjustment, { description: 'batch', itemAdjustments: [{}] });

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: { description: 'batch' } },
      { itemAdjustments: [{ buyPrice: 7 }, { buyPrice: 9 }] },
    );

    expect([await this.adjustmentPrices(first), await this.adjustmentPrices(second)]).toEqual([
      [7, 9],
      [7, 9],
    ]);
    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(4);
  }

  /** The rows are settled before the update, so a payload changing the column `$where` reads still cascades to them. */
  async shouldUpdateManyAndCascadeWhenThePayloadChangesTheFilteredColumn() {
    const id = await this.querier.insertOne(InventoryAdjustment, { description: 'draft' });

    const changes = await this.querier.updateMany(
      InventoryAdjustment,
      { $where: { description: 'draft' } },
      { description: 'final', itemAdjustments: [{ buyPrice: 7 }] },
    );

    expect(changes).toBe(1);
    const found = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId: id } });
    expect(found.map(({ buyPrice }) => buyPrice)).toEqual([7]);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(2);

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: {} },
      {
        itemAdjustments: null,
      },
      { unfiltered: true },
    );

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(0);
  }

  async shouldInsertOneAndCascadeManyToMany() {
    const tags: Tag[] = [
      { name: 'tag one', createdAt: 1 },
      { name: 'tag two', createdAt: 1 },
    ];
    const payload: Item = { name: 'item one', createdAt: 1, tags };

    const id = await this.querier.insertOne(Item, payload);

    const foundItem = await this.querier.findOneById(Item, id, {
      $select: { id: true, name: true, createdAt: true },
      $populate: { tags: { $select: { name: true, createdAt: true }, $sort: { name: 1 } } },
    });

    expect(foundItem).toMatchObject({
      id,
      ...payload,
    });

    const foundTags = await this.querier.findMany(Tag, {
      $select: { name: true, createdAt: true },
      $populate: { items: { $select: { id: true, name: true, createdAt: true } } },
      $sort: { name: 1 },
    });

    const item = { id, name: payload.name, createdAt: payload.createdAt };
    expect(foundTags).toMatchObject(tags.map((tag) => ({ ...tag, items: [item] })));
  }

  /**
   * A narrowed query keeps its projection while populating, and the relation's own narrows inside the join,
   * which on MongoDB means the aggregation path.
   */
  async shouldNarrowTheProjectionWhilePopulatingAJoinedRelation() {
    const measureUnitId = await this.querier.insertOne(MeasureUnit, { name: 'unit one' });
    const id = await this.querier.insertOne(Item, { name: 'item one', salePrice: 5, measureUnitId });

    const found = await this.querier.findOneById(Item, id, {
      $select: { salePrice: false },
      $populate: { measureUnit: { $select: { name: true } } },
    });

    expect(found).toMatchObject({ id, name: 'item one', measureUnit: { name: 'unit one' } });
    expect(found).not.toHaveProperty('salePrice');
    expect(found?.measureUnit).not.toHaveProperty('categoryId');
  }

  /** A joined document keeps its own key on every engine, exactly as the parent's does. */
  async shouldKeepAJoinedRelationsIdDespiteAFalsySelect() {
    const measureUnitId = await this.querier.insertOne(MeasureUnit, { name: 'unit one' });
    const id = await this.querier.insertOne(Item, { name: 'item one', measureUnitId });

    const found = await this.querier.findOneById(Item, id, {
      $populate: { measureUnit: { $select: { id: false } } },
    });

    expect(found?.measureUnit).toMatchObject({ id: measureUnitId, name: 'unit one' });
  }

  /** A relation query names the target's columns, so a m2m one must not reach the join table. */
  async shouldPopulateManyToManyWithAFalsySelect() {
    const id = await this.querier.insertOne(Item, {
      name: 'item one',
      createdAt: 1,
      tags: [{ name: 'tag one', createdAt: 1 }],
    });

    const found = await this.querier.findOneById(Item, id, {
      $populate: { tags: { $select: { name: false } } },
    });

    expect(found?.tags).toHaveLength(1);
    expect(found?.tags?.[0]).not.toHaveProperty('name');
  }

  async shouldFilterAManyToManyRelation() {
    const id = await this.querier.insertOne(Item, {
      name: 'item one',
      createdAt: 1,
      tags: [
        { name: 'keep', createdAt: 1 },
        { name: 'drop', createdAt: 1 },
      ],
    });

    const found = await this.querier.findOneById(Item, id, {
      $populate: { tags: { $select: { name: true }, $where: { name: 'keep' } } },
    });

    expect(found?.tags).toMatchObject([{ name: 'keep' }]);
  }

  async shouldUpdateOneAndCascadeManyToMany() {
    const id = await this.querier.insertOne(Item, { createdAt: 1 });
    const payload: Item = {
      name: 'item one',
      updatedAt: 1,
      tags: [
        {
          name: 'tag one',
          createdAt: 1,
        },
        {
          name: 'tag two',
          createdAt: 1,
        },
      ],
    };

    await this.querier.updateOneById(Item, id, payload);

    const found = await this.querier.findOneById(Item, id, {
      $select: { id: true, name: true, updatedAt: true },
      $populate: { tags: { $sort: { name: 1 } } },
    });

    expect(found).toMatchObject({
      id,
      ...payload,
    });
  }

  /** Updating a 1-1 replaces the child rather than leaving the old row behind for a `$populate` to choose from. */
  async shouldUpdateOneAndReplaceOneToOne() {
    const id = await this.querier.insertOne(User, {
      name: 'Profile Replace',
      createdAt: 1,
      profile: { picture: 'first', createdAt: 1 },
    });

    await this.querier.updateOneById(User, id, { profile: { picture: 'second', updatedAt: 2 } });

    const profiles = await this.querier.findMany(Profile, { $select: { picture: true } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].picture).toBe('second');
  }

  async shouldUpdateWithJsonOperators() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Merge',
      kind: { public: 1, tags: ['a', 'b'] },
    });

    const mergeResult = await this.querier.updateOneById(Company, id, {
      kind: { $set: { private: 1 } },
    });
    expect(mergeResult).toBe(1);

    let found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, private: 1, tags: ['a', 'b'] });

    const pushResult = await this.querier.updateOneById(Company, id, {
      kind: { $push: { tags: 'c' } },
    });
    expect(pushResult).toBe(1);

    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, private: 1, tags: ['a', 'b', 'c'] });

    const unsetResult = await this.querier.updateOneById(Company, id, {
      kind: { $unset: ['public'] },
    });
    expect(unsetResult).toBe(1);

    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ private: 1, tags: ['a', 'b', 'c'] });
  }

  /**
   * `$pull` removes every matching element, leaves the array as it is when none matches, and leaves an
   * empty array rather than a missing key once it pulls the last.
   */
  async shouldPullFromJsonArray() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Pull',
      kind: { public: 1, tags: ['a', 'b', 'a', 'c'] },
    });

    const pullResult = await this.querier.updateOneById(Company, id, {
      kind: { $pull: { tags: 'a' } },
    });
    expect(pullResult).toBe(1);

    let found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, tags: ['b', 'c'] });

    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'absent' } } });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, tags: ['b', 'c'] });

    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'b' } } });
    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'c' } } });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, tags: [] });
  }

  /** Every operator in one payload, each on a key of its own. */
  async shouldCombineJsonOperatorsOnTheirOwnKeys() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Combined',
      kind: { public: 1, tags: ['a', 'b', 'a'], labels: ['x'] },
    });

    const result = await this.querier.updateOneById(Company, id, {
      kind: {
        $pull: { tags: 'a' },
        $push: { labels: 'y' },
        $addToSet: { ranks: 1 },
        $set: { private: 1 },
        $unset: ['public'],
      },
    });
    expect(result).toBe(1);

    expect(await this.kindOf(id)).toEqual({ private: 1, tags: ['b'], labels: ['x', 'y'], ranks: [1] });
  }

  /** `$set` replaces a key's array or object whole. */
  async shouldSetAJsonKeyToAnArrayOrAnObject() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Set Whole',
      kind: { tags: ['stale'], theme: { color: 'red', size: 2 } },
    });

    await this.querier.updateOneById(Company, id, { kind: { $set: { tags: ['kept'], theme: { color: 'blue' } } } });

    expect(await this.kindOf(id)).toEqual({ tags: ['kept'], theme: { color: 'blue' } });
  }

  /** A `$pull` on an absent key is a no-op: it must not create the key or null the document. */
  async shouldPullFromMissingJsonKeyAsNoop() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Pull Missing',
      kind: { public: 1 },
    });

    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'a' } } });

    expect(await this.kindOf(id)).toEqual({ public: 1 });
  }

  /** A `$pull` leaves a key holding no array as it is, as an older writer may have left it. */
  async shouldPullFromANonArrayJsonKeyAsNoop() {
    const ids = await this.querier.insertMany(LooseDoc, [
      { name: 'JSON Pull Scalar', doc: { public: 1, tags: 'a' } },
      { name: 'JSON Pull Object', doc: { public: 1, tags: { k: 'a' } } },
      { name: 'JSON Pull Array', doc: { public: 1, tags: ['a', 'b'] } },
    ]);

    await this.querier.updateMany(LooseDoc, { $where: { id: ids } }, { doc: { $pull: { tags: 'a' } } });

    expect(await this.namedDocs(ids)).toEqual([
      ['JSON Pull Array', { public: 1, tags: ['b'] }],
      ['JSON Pull Object', { public: 1, tags: { k: 'a' } }],
      ['JSON Pull Scalar', { public: 1, tags: 'a' }],
    ]);
  }

  /**
   * The `$pull` on the absent `labels` stays a no-op beside a write to another key, which a guard on the
   * pulled key alone keeps from creating `labels` as an empty array.
   */
  async shouldPullFromMissingJsonKeyWhileCombining() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Pull Missing Combined',
      kind: { public: 1, tags: ['a', 'b'] },
    });

    await this.querier.updateOneById(Company, id, {
      kind: { $pull: { labels: 'x' }, $push: { tags: 'z' } },
    });

    expect(await this.kindOf(id)).toEqual({ public: 1, tags: ['a', 'b', 'z'] });
  }

  /**
   * A page walks the rows as the engine's own `ORDER BY` puts them, nulls and ties included: every page
   * read past the one before is the next slice of the one `findMany` sorted the same way, and a key the
   * projection leaves out is read for the cursor and taken back off the rows.
   */
  async shouldPageByCursorAsTheSortOrdersTheRows() {
    await this.insertPricedItems();
    const q = { $select: { name: true }, $sort: { salePrice: -1, id: 1 } } as const;

    const pages = await this.walkPages(Item, { ...q, $limit: 2 });

    expect(pages.map((page) => page.items.length)).toEqual([2, 2, 2, 1]);
    expect(pages.flatMap((page) => page.items)).toEqual(await this.querier.findMany(Item, q));
  }

  /** The same walk under a placement, which reads the same on every engine, the null block last. */
  async shouldPageByCursorUnderANullPlacement() {
    await this.insertPricedItems();
    const q = { $select: { name: true }, $sort: { code: 'ascNullsLast', id: -1 } } as const;

    const items = (await this.walkPages(Item, { ...q, $limit: 3 })).flatMap((page) => page.items);

    expect(items).toEqual(await this.querier.findMany(Item, q));
    expect(items.slice(-2)).toEqual([{ name: 'priced 4' }, { name: 'priced 1' }]);
  }

  /**
   * `$before` walks the same pages back, from the last page's start to the first, across the null block
   * wherever the engine puts it: each page is the one `$after` read forward.
   */
  async shouldPageBackFromTheLastPageToTheFirst() {
    await this.insertPricedItems();
    const q = { $select: { name: true }, $sort: { salePrice: -1, id: 1 }, $limit: 2 } as const;
    const forward = await this.walkPages(Item, q);

    const back = await this.walkPagesBack(Item, q, forward[forward.length - 1]);

    expect(back.map((page) => page.items)).toEqual(
      forward
        .slice(0, -1)
        .map((page) => page.items)
        .reverse(),
    );
    expect(back.map((page) => [page.hasPrevPage, page.hasNextPage])).toEqual([
      [true, true],
      [true, true],
      [false, true],
    ]);
  }

  /**
   * A date and a bigint cross the cursor as what they are, on every engine: the next page compares against
   * the same instant and the same exact integer, ties and nulls included.
   */
  async shouldPageByADateAndABigIntKey() {
    const at = (ms: number) => new Date(Date.UTC(2026, 8, 28, 10, 0, 0, ms));
    const rows = [
      { id: 1, at: at(5), wide: 2n ** 62n },
      { id: 2, at: null, wide: -(2n ** 62n) },
      { id: 3, at: at(5), wide: null },
      { id: 4, at: at(1), wide: 2n ** 62n + 1n },
      { id: 5, at: at(9), wide: 2n ** 62n },
    ];
    await this.querier.insertMany(
      TypedRow,
      rows.map((row) => ({ ...row, name: 'paged' })),
    );
    const byDate = { $select: { id: true }, $sort: { at: -1, id: 1 } } as const;
    const byBigInt = { $select: { id: true }, $sort: { wide: 1, id: 1 } } as const;

    const dated = await this.walkPages(TypedRow, { ...byDate, $limit: 2 });
    const wide = await this.walkPages(TypedRow, { ...byBigInt, $limit: 2 });

    expect(dated.flatMap((page) => page.items)).toEqual(await this.querier.findMany(TypedRow, byDate));
    expect(wide.flatMap((page) => page.items)).toEqual(await this.querier.findMany(TypedRow, byBigInt));
  }

  /** A page populates as `findMany` does, the key it reads for the cursor taken back off each row. */
  async shouldPageWithItsRelationsPopulated() {
    const [mass, length] = await this.querier.insertMany(MeasureUnitCategory, [{ name: 'mass' }, { name: 'length' }]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'kg', categoryId: mass },
      { name: 'g', categoryId: mass },
      { name: 'm', categoryId: length },
    ]);
    const q = {
      $select: { name: true },
      $populate: { measureUnits: { $select: { name: true }, $sort: { name: 1 } } },
      $sort: { id: 1 },
    } as const;

    const pages = await this.walkPages(MeasureUnitCategory, { ...q, $limit: 1 });

    expect(pages.flatMap((page) => page.items)).toEqual(await this.querier.findMany(MeasureUnitCategory, q));
  }

  /**
   * Seven items: a tie on each price, two with none, and codes where the nulls fall apart from the prices'.
   * One at a time, so each key is minted after the last and the ties break in insertion order.
   */
  private async insertPricedItems() {
    const prices = [3, null, 1, 3, null, 2, 1];
    const codes = ['b', null, 'a', 'b', null, 'c', 'a'];
    for (const [at, salePrice] of prices.entries()) {
      await this.querier.insertOne(Item, { name: `priced ${at}`, salePrice, code: codes[at] });
    }
  }

  /**
   * Every page `q` reads from its first, each past the one before's end. At most 20, so a cursor that never
   * moves on fails the comparison instead of looping.
   */
  protected async walkPages<E extends object>(entity: Type<E>, q: QueryKeyset<E>) {
    const pages: CursorPage<E>[] = [];
    let page: CursorPage<E> | undefined;
    do {
      page = await this.querier.findManyPage(entity, { ...q, $after: page?.endCursor });
      pages.push(page);
    } while (page.hasNextPage && pages.length < 20);
    return pages;
  }

  /** Every page `q` reads ahead of `last`, each ahead of the one before's start, as {@link walkPages} does. */
  private async walkPagesBack<E extends object>(entity: Type<E>, q: QueryKeyset<E>, last: CursorPage<E>) {
    const pages: CursorPage<E>[] = [];
    let page = last;
    do {
      page = await this.querier.findManyPage(entity, { ...q, $before: page.startCursor });
      pages.push(page);
    } while (page.hasPrevPage && pages.length < 20);
    return pages;
  }

  /**
   * Where nulls land is asked for rather than left to the engine: unqualified, Postgres sorts them last
   * on `asc` where every other engine sorts them first. A placement reads the same everywhere: through
   * `NULLS FIRST/LAST` where the engine has it, a leading term where it does not.
   */
  async shouldSortByNullPlacement() {
    const names = ['nulls valued a', 'nulls null', 'nulls valued c'];
    await this.querier.insertMany(Item, [
      { name: names[0], code: 'a' },
      { name: names[1], code: null },
      { name: names[2], code: 'c' },
    ]);
    const page = { $select: { name: true }, $where: { name: { $in: names } } } as const;

    const ascLast = await this.querier.findMany(Item, { ...page, $sort: { code: 'ascNullsLast' } });
    expect(ascLast.map(({ name }) => name)).toEqual([names[0], names[2], names[1]]);

    const ascFirst = await this.querier.findMany(Item, { ...page, $sort: { code: 'ascNullsFirst' } });
    expect(ascFirst.map(({ name }) => name)).toEqual([names[1], names[0], names[2]]);

    const descFirst = await this.querier.findMany(Item, { ...page, $sort: { code: 'descNullsFirst' } });
    expect(descFirst.map(({ name }) => name)).toEqual([names[1], names[2], names[0]]);

    const descLast = await this.querier.findMany(Item, { ...page, $sort: { code: 'descNullsLast' } });
    expect(descLast.map(({ name }) => name)).toEqual([names[2], names[0], names[1]]);
  }

  /** An operator inside `$not` is translated like any other, on MongoDB too, where `$isNull` is uql's own. */
  async shouldNegateAnIsNull() {
    const names = ['ni null', 'ni valued'];
    await this.querier.insertMany(Item, [
      { name: names[0], code: null },
      { name: names[1], code: 'a' },
    ]);
    const found = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { name: { $in: names }, code: { $not: { $isNull: true } } },
    });
    expect(found.map(({ name }) => name)).toEqual([names[1]]);
  }

  /** Filtering and sorting by a JSON dot-path, which MySQL reads through a full JSON path (`'$.public'`). */
  async shouldFindAndSortByJsonDotPath() {
    await this.querier.insertOne(Company, { name: 'JSON Scalar One', kind: { public: 1 } });
    await this.querier.insertOne(Company, { name: 'JSON Scalar Zero', kind: { public: 0 } });

    expect(await this.companyNames({ 'kind.public': 1 })).toEqual(['JSON Scalar One']);

    const sorted = await this.querier.findMany(Company, { $sort: { 'kind.public': -1 } });
    expect(sorted.map(({ name }) => name)).toEqual(['JSON Scalar One', 'JSON Scalar Zero']);
  }

  /**
   * Filtering, ordering and populating in one read. MongoDB takes each as a stage of its own: one stage
   * object with two fields is refused outright.
   */
  async shouldFindManyFilteredSortedAndPopulated() {
    const taxId = await this.querier.insertOne(Tax, { name: 'Combined tax', percentage: 1 });
    await this.querier.insertMany(Item, [
      { name: 'combined', code: 'b', taxId },
      { name: 'combined', code: 'a', taxId },
    ]);

    const founds = await this.querier.findMany(Item, {
      $select: { code: true },
      $where: { name: 'combined' },
      $sort: { code: 1 },
      $populate: { tax: { $select: { name: true } } },
    });

    expect(founds.map(({ code }) => code)).toEqual(['a', 'b']);
    expect(founds[0].tax?.name).toBe('Combined tax');
  }

  /** A relation of a relation comes back filled, at every level the query asked for. */
  async shouldPopulateANestedToOneRelation() {
    const categoryId = await this.querier.insertOne(TaxCategory, { name: 'Nested category' });
    const taxId = await this.querier.insertOne(Tax, { name: 'Nested tax', percentage: 1, categoryId });
    const itemId = await this.querier.insertOne(Item, { name: 'nested item', taxId });

    const found = await this.querier.findOneById(Item, itemId, {
      $select: { name: true },
      $populate: { tax: { $select: { name: true }, $populate: { category: { $select: { name: true } } } } },
    });

    expect(found?.tax?.name).toBe('Nested tax');
    expect(found?.tax?.category?.name).toBe('Nested category');
  }

  /**
   * Ordering parents by how many rows a to-many holds, as "the categories with the most units" does: a
   * correlated tally per parent, so no relation rows are loaded and the page still cuts to a top-N.
   */
  async shouldSortByARelationCount() {
    const [many, few, none] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'many units' },
      { name: 'few units' },
      { name: 'no units' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'a', categoryId: many },
      { name: 'b', categoryId: many },
      { name: 'c', categoryId: many },
      { name: 'd', categoryId: few },
    ]);

    const desc = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $sort: { measureUnits: { $count: -1 } },
    });
    expect(desc.map((it) => it.id)).toEqual([many, few, none]);

    const asc = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $sort: { measureUnits: { $count: 1 } },
    });
    expect(asc.map((it) => it.id)).toEqual([none, few, many]);
  }

  /** The tally is what the page cuts on, so a top-N never loads the relation rows it ranked by. */
  async shouldSortByARelationCountAndPage() {
    const [many, few] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'paged many' },
      { name: 'paged few' },
      { name: 'paged none' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'a', categoryId: many },
      { name: 'b', categoryId: many },
      { name: 'c', categoryId: few },
    ]);

    const top = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $sort: { measureUnits: { $count: -1 } },
      $limit: 2,
    });
    expect(top.map((it) => it.id)).toEqual([many, few]);
  }

  /** A many-to-many ranks on its junction rows, one per pairing. */
  async shouldSortByAManyToManyRelationCount() {
    const two = await this.querier.insertOne(Item, {
      name: 'two tags',
      createdAt: 1,
      tags: [
        { name: 'x1', createdAt: 1 },
        { name: 'x2', createdAt: 1 },
      ],
    });
    const one = await this.querier.insertOne(Item, {
      name: 'one tag',
      createdAt: 1,
      tags: [{ name: 'x3', createdAt: 1 }],
    });

    const found = await this.querier.findMany(Item, {
      $select: { id: true },
      $sort: { tags: { $count: -1 } },
    });
    expect(found.map((it) => it.id)).toEqual([two, one]);
  }

  /**
   * `$distinct` collapses rows onto the columns it projects, and a relation tally is not one of
   * them, so ranking by one is refused rather than answered all-equal, on every backend.
   */
  async shouldRefuseSortingByARelationCountWithDistinct() {
    await expect(
      this.querier.findMany(MeasureUnitCategory, {
        $select: { name: true },
        $distinct: true,
        $sort: { measureUnits: { $count: -1 } },
      }),
    ).rejects.toThrow(/\$distinct/);
  }

  /** The ordering composes with the tally itself: rank by it, and read it. */
  async shouldSortByARelationCountAndReturnIt() {
    const [many, few] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'both many' },
      { name: 'both few' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'a', categoryId: many },
      { name: 'b', categoryId: many },
      { name: 'c', categoryId: few },
    ]);

    const found = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $sort: { measureUnits: { $count: -1 } },
      $count: { measureUnits: true },
    });
    expect(found.map((it) => it._count.measureUnits)).toEqual([2, 1]);
  }

  /**
   * A relation aggregate is a field: the same tally `$count` answers with, under a name every clause
   * takes, filtering and ordering by the expression, which no read has to have selected. Read only where
   * a query names it, and narrowed by the target's own filters, so a soft-deleted row is as invisible here
   * as it is to `$count`.
   */
  async shouldReadARelationAggregateAsAField() {
    const [alpha, beta] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'aggregate alpha' },
      { name: 'aggregate beta' },
    ]);
    const [, , third] = await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId: alpha },
      { name: 'two', categoryId: alpha },
      { name: 'three', categoryId: beta },
    ]);

    const read = await this.querier.findMany(MeasureUnitCategory, {
      $select: { name: true, unitCount: true },
      $where: { name: { $istartsWith: 'aggregate' } },
      $sort: { name: 1 },
    });
    expect(read.map((it) => it.unitCount)).toEqual([2, 1]);

    const filtered = await this.querier.findMany(MeasureUnitCategory, {
      $select: { name: true },
      $where: { name: { $istartsWith: 'aggregate' }, unitCount: { $gte: 2 } },
      $sort: { unitCount: -1 },
    });
    expect(filtered.map((it) => it.name)).toEqual(['aggregate alpha']);

    await this.querier.deleteOneById(MeasureUnit, third);
    const afterDelete = await this.querier.findOne(MeasureUnitCategory, {
      $select: { unitCount: true },
      $where: { id: beta },
    });
    expect(afterDelete?.unitCount).toBe(0);
  }

  /** The `kind` of the company with `id`, as stored. */
  protected async kindOf(id: Company['id']) {
    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    return found?.kind;
  }

  /** Each loose document's name and JSON, by name. */
  protected async namedDocs(ids: LooseDoc['id'][]) {
    const found = await this.querier.findMany(LooseDoc, {
      $select: { name: true, doc: true },
      $where: { id: ids },
      $sort: { name: 1 },
    });
    return found.map(({ name, doc }) => [name, doc]);
  }

  /**
   * The names `$where` matches, in code-unit order whatever the column's collation. An aggregate's own
   * `$where` must match the same rows, so every filter here also pins that it means one thing in both.
   */
  protected async categoryNames($where: QueryWhere<MeasureUnitCategory>) {
    const [rows, tallies] = await Promise.all([
      this.querier.findMany(MeasureUnitCategory, { $select: { id: true, name: true }, $where }),
      this.querier.aggregate(MeasureUnitCategory, { $group: { id: true }, $select: { n: { $count: '*', $where } } }),
    ]);
    expectSameRows(rows, tallies);
    return rows.map((it) => it.name).sort();
  }

  /** As {@link categoryNames}, over readings. */
  private async readingNames($where: QueryWhere<Reading>) {
    const [rows, tallies] = await Promise.all([
      this.querier.findMany(Reading, { $select: { id: true, name: true }, $where }),
      this.querier.aggregate(Reading, { $group: { id: true }, $select: { n: { $count: '*', $where } } }),
    ]);
    expectSameRows(rows, tallies);
    return rows.map((it) => it.name).sort();
  }

  /** As {@link categoryNames}, over companies. */
  private async companyNames($where: QueryWhere<Company>) {
    const [rows, tallies] = await Promise.all([
      this.querier.findMany(Company, { $select: { id: true, name: true }, $where }),
      this.querier.aggregate(Company, { $group: { id: true }, $select: { n: { $count: '*', $where } } }),
    ]);
    expectSameRows(rows, tallies);
    return rows.map((it) => it.name).sort();
  }

  private async taxCategoryNames(...pks: TaxCategory['pk'][]) {
    const rows = await this.querier.findMany(TaxCategory, {
      $select: { name: true },
      $where: { pk: pks },
      $sort: { name: 1 },
    });
    return rows.map((it) => it.name);
  }

  async shouldMatchAStringOperatorValueLiterally() {
    await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'lit 50% off' },
      { name: 'lit 50x off' },
      { name: 'lit a_b' },
      { name: 'lit axb' },
      { name: 'lit a.b(' },
      { name: 'lit back\\slash' },
      { name: 'lit backXslash' },
      { name: 'lit [x]' },
      { name: 'lit x' },
    ]);
    expect(await this.categoryNames({ name: { $includes: '50%' } })).toEqual(['lit 50% off']);
    expect(await this.categoryNames({ name: { $startsWith: 'lit a_' } })).toEqual(['lit a_b']);
    expect(await this.categoryNames({ name: { $iendsWith: 'A.B(' } })).toEqual(['lit a.b(']);
    expect(await this.categoryNames({ name: { $iincludes: 'K\\S' } })).toEqual(['lit back\\slash']);
    expect(await this.categoryNames({ name: { $includes: '[x]' } })).toEqual(['lit [x]']);
  }

  async shouldMatchALikePatternWholeWithBackslashEscapes() {
    await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'pat a_b' },
      { name: 'pat axb' },
      { name: 'pat a.b' },
      { name: 'pat [a]' },
    ]);
    expect(await this.categoryNames({ name: { $like: 'pat a_b' } })).toEqual(['pat a.b', 'pat a_b', 'pat axb']);
    expect(await this.categoryNames({ name: { $like: 'pat [a]%' } })).toEqual(['pat [a]']);
    expect(await this.categoryNames({ name: { $like: 'pat a\\_b' } })).toEqual(['pat a_b']);
    expect(await this.categoryNames({ name: { $ilike: 'PAT A.B' } })).toEqual(['pat a.b']);
    expect(await this.categoryNames({ name: { $like: 'pat a' } })).toEqual([]);
    await expect(this.categoryNames({ name: { $like: 'pat a\\' } })).rejects.toThrow('with nothing after it to escape');
  }

  /** Case-sensitive on every engine, whatever the column's collation folds. */
  async shouldMatchARegexCaseSensitively() {
    await this.querier.insertMany(MeasureUnitCategory, [{ name: 'Alpha' }, { name: 'beta' }, { name: 'alpha' }]);
    expect(await this.categoryNames({ name: { $regex: '^A' } })).toEqual(['Alpha']);
    expect(await this.categoryNames({ name: { $regex: '^a|^b' } })).toEqual(['alpha', 'beta']);
  }

  /** A leading `(?i)` folds case, as Mongo's `$options: 'i'` does, on every engine but embedded libSQL. */
  async shouldMatchARegexCaseInsensitivelyByALeadingFlag() {
    await this.querier.insertMany(MeasureUnitCategory, [{ name: 'Alpha' }, { name: 'beta' }, { name: 'alpha' }]);
    expect(await this.categoryNames({ name: { $regex: '(?i)^A' } })).toEqual(['Alpha', 'alpha']);
  }

  /** A NULL value matches no pattern, not even one spelling `null`, as an operator answers NULL. */
  async shouldNotMatchANullValueByARegex() {
    await this.querier.insertMany(MeasureUnitCategory, [{ name: null }, { name: 'null' }]);
    expect(await this.categoryNames({ name: { $regex: 'ul' } })).toEqual(['null']);
  }

  /** A value is compared as written, a leading `$` included, and a field's `$not` negates a value or a list as it does an operator. */
  async shouldMatchAValueAsWritten() {
    await this.querier.insertMany(MeasureUnitCategory, [{ name: '$name' }, { name: 'name' }, { name: 'other' }]);
    expect(await this.categoryNames({ name: '$name' })).toEqual(['$name']);
    expect(await this.categoryNames({ name: { $in: ['$name'] } })).toEqual(['$name']);
    expect(await this.categoryNames({ name: { $startsWith: '$' } })).toEqual(['$name']);
    expect(await this.categoryNames({ name: { $not: 'name' } })).toEqual(['$name', 'other']);
    expect(await this.categoryNames({ name: { $not: ['name', 'other'] } })).toEqual(['$name']);
  }

  /** A relation aggregate groups and aggregates like any field: the rows computing it are read first. */
  async shouldAggregateARelationAggregate() {
    const [alpha, beta, gamma] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'grouped alpha' },
      { name: 'grouped beta' },
      { name: 'grouped gamma' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId: alpha },
      { name: 'two', categoryId: alpha },
      { name: 'three', categoryId: beta },
      { name: 'four', categoryId: gamma },
    ]);
    const $where = { name: { $istartsWith: 'grouped' } };

    const byCount = await this.querier.aggregate(MeasureUnitCategory, {
      $where,
      $group: { unitCount: true },
      $select: { categories: { $count: '*' } },
      $having: { categories: { $gte: 1 } },
      $sort: { unitCount: 1 },
    });
    expect(byCount).toEqual([
      { unitCount: 1, categories: 2 },
      { unitCount: 2, categories: 1 },
    ]);

    const totals = await this.querier.aggregate(MeasureUnitCategory, {
      $where,
      $select: { units: { $sum: { unitCount: true } }, most: { $max: { unitCount: true } } },
    });
    expect(totals).toEqual([{ units: 4, most: 2 }]);
  }

  /** Every statement taking a `$where` reads a relation aggregate in it, at any depth. */
  async shouldFilterEveryStatementByARelationAggregate() {
    const [alpha, beta] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'filtered alpha' },
      { name: 'filtered beta' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId: alpha },
      { name: 'two', categoryId: alpha },
      { name: 'three', categoryId: beta },
    ]);
    const $where = { name: { $istartsWith: 'filtered' }, $or: [{ unitCount: { $gte: 2 } }, { name: 'none' }] };

    expect(await this.querier.count(MeasureUnitCategory, { $where })).toBe(1);
    expect(
      await this.querier.aggregate(MeasureUnitCategory, { $where, $select: { categories: { $count: '*' } } }),
    ).toEqual([{ categories: 1 }]);

    expect(await this.querier.updateMany(MeasureUnitCategory, { $where }, { name: 'filtered, updated' })).toBe(1);
    const updated = await this.querier.findOneById(MeasureUnitCategory, alpha, { $select: { name: true } });
    expect(updated?.name).toBe('filtered, updated');

    expect(await this.querier.deleteMany(MeasureUnitCategory, { $where })).toBe(1);
    expect(await this.querier.count(MeasureUnitCategory, { $where: { name: { $istartsWith: 'filtered' } } })).toBe(1);
  }

  /**
   * A report in one statement: rows grouped by a to-one relation's field, pivoted into columns by each
   * aggregate's own `$where`. A group no row of an aggregate reaches answers null, as SQL does, and a row
   * pointing nowhere is in no group of the path, where its own foreign key groups it under null.
   */
  async shouldAggregateAcrossARelationPivotingByEachAggregatesWhere() {
    const [itemA, itemB] = await this.querier.insertMany(Item, [{ code: 'pivot-a' }, { code: 'pivot-b' }]);
    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, { description: 'pivot' });
    await this.querier.insertMany(ItemAdjustment, [
      { inventoryAdjustmentId, itemId: itemA, number: 1, buyPrice: 10 },
      { inventoryAdjustmentId, itemId: itemA, number: 2, buyPrice: 5 },
      { inventoryAdjustmentId, itemId: itemB, number: 1, buyPrice: 7 },
      { inventoryAdjustmentId, number: 1, buyPrice: 3 },
    ]);

    const rows = await this.querier.aggregate(ItemAdjustment, {
      $where: { inventoryAdjustmentId, item: { code: { $startsWith: 'pivot' } } },
      $group: { code: { item: { code: true } } },
      $select: {
        ones: { $sum: { buyPrice: true }, $where: { number: 1 } },
        twos: { $sum: { buyPrice: true }, $where: { number: 2 } },
        adjustments: { $count: '*' },
      },
      $sort: { code: 1 },
    });
    expect(rows).toEqual([
      { code: 'pivot-a', ones: 10, twos: 5, adjustments: 2 },
      { code: 'pivot-b', ones: 7, twos: null, adjustments: 1 },
    ]);

    const pathGroups = await this.querier.aggregate(ItemAdjustment, {
      $where: { inventoryAdjustmentId, itemId: null },
      $group: { code: { item: { code: true } } },
      $select: { adjustments: { $count: '*' } },
    });
    expect(pathGroups).toEqual([]);
    const [orphans, ...rest] = await this.querier.aggregate(ItemAdjustment, {
      $where: { inventoryAdjustmentId, itemId: null },
      $group: { itemId: true },
      $select: { adjustments: { $count: '*' } },
    });
    expect(rest).toEqual([]);
    expect(orphans?.itemId == null).toBe(true);
    expect(orphans?.adjustments).toBe(1);
  }

  /**
   * Each aggregate filters its own rows by a relation, to-many included, beside the statement's `$where`.
   * Grouped, each group tallies its own rows, so the same relation filter answers per group.
   */
  async shouldFilterEachAggregateByARelation() {
    const [alpha, beta] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'per-op alpha' },
      { name: 'per-op beta' },
      { name: 'per-op gamma' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'per-op kg', categoryId: alpha },
      { name: 'per-op g', categoryId: alpha },
      { name: 'per-op l', categoryId: beta },
    ]);
    const $where = { name: { $istartsWith: 'per-op' } };

    const [totals] = await this.querier.aggregate(MeasureUnitCategory, {
      $where,
      $select: {
        all: { $count: '*' },
        kg: { $count: '*', $where: { measureUnits: { name: 'per-op kg' } } },
        either: {
          $count: '*',
          $where: { $or: [{ measureUnits: { name: 'per-op kg' } }, { measureUnits: { name: 'per-op l' } }] },
        },
        twoUnits: { $count: '*', $where: { measureUnits: { $size: 2 } } },
      },
    });
    expect(totals).toEqual({ all: 3, kg: 1, either: 2, twoUnits: 1 });

    const byUnits = await this.querier.aggregate(MeasureUnitCategory, {
      $where,
      $group: { unitCount: true },
      $select: { categories: { $count: '*' }, kg: { $count: '*', $where: { measureUnits: { name: 'per-op kg' } } } },
      $sort: { unitCount: 1 },
    });
    expect(byUnits).toEqual([
      { unitCount: 0, categories: 1, kg: 0 },
      { unitCount: 1, categories: 1, kg: 0 },
      { unitCount: 2, categories: 1, kg: 1 },
    ]);
  }

  /** An aggregate's `$where` constrains a relation as a find's does. */
  async shouldAggregateRowsFilteredByARelation() {
    const [alpha] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'related alpha' },
      { name: 'related beta' },
    ]);
    await this.querier.insertMany(MeasureUnit, [{ name: 'related kg', categoryId: alpha }]);

    const rows = await this.querier.aggregate(MeasureUnitCategory, {
      $where: { name: { $istartsWith: 'related' }, measureUnits: { name: 'related kg' } },
      $select: { categories: { $count: '*' } },
    });
    expect(rows).toEqual([{ categories: 1 }]);
  }

  /**
   * `$count` answers how many rows a relation holds without loading one, under `_count`. One grouped
   * aggregate per relation over every parent at once, so the cost does not grow with the page.
   */
  async shouldCountAOneToManyRelation() {
    const [alpha, beta] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'alpha category' },
      { name: 'beta category' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId: alpha },
      { name: 'two', categoryId: alpha },
      { name: 'three', categoryId: beta },
    ]);

    const found = await this.querier.findMany(MeasureUnitCategory, {
      $select: { name: true },
      $sort: { name: 1 },
      $count: { measureUnits: true },
    });

    expect(found.map((it) => it._count.measureUnits)).toEqual([2, 1]);
  }

  /** A tally read inside the statement needs no id, so `$distinct` deduplicates whole rows, tallies included. */
  async shouldCountBeside$distinct() {
    const [first, second] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'same name' },
      { name: 'same name' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId: first },
      { name: 'two', categoryId: second },
    ]);

    const found = await this.querier.findMany(MeasureUnitCategory, {
      $select: { name: true },
      $distinct: true,
      $count: { measureUnits: true },
    });

    expect(found).toEqual([{ name: 'same name', _count: { measureUnits: 1 } }]);
  }

  /** A parent with no related row counts zero, not a missing key. */
  async shouldCountARelationHoldingNothing() {
    await this.querier.insertOne(MeasureUnitCategory, { name: 'empty category' });

    const [found] = await this.querier.findMany(MeasureUnitCategory, {
      $where: { name: 'empty category' },
      $count: { measureUnits: true },
    });

    expect(found._count).toEqual({ measureUnits: 0 });
  }

  /**
   * A to-many under a to-one hangs off the joined row: its rows where the join matched, none where the
   * row has no children, and no row at all where the join matched nothing.
   */
  async shouldPopulateAToManyUnderAToOne() {
    const [weightId, volumeId] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'weight' },
      { name: 'volume' },
    ]);
    const ids = await this.querier.insertMany(MeasureUnit, [
      { name: 'kg', categoryId: weightId },
      { name: 'g', categoryId: weightId },
      { name: 'l', categoryId: volumeId },
      { name: 'orphan' },
    ]);

    const units = await this.querier.findMany(MeasureUnit, {
      $select: { name: true },
      $where: { id: ids },
      $sort: { name: 1 },
      $populate: {
        category: {
          $select: { name: true },
          $populate: { measureUnits: { $select: { name: true }, $where: { name: { $ne: 'l' } }, $sort: { name: 1 } } },
        },
      },
    });

    const weight = { name: 'weight', measureUnits: [{ name: 'g' }, { name: 'kg' }] };
    expect(units).toMatchObject([
      { name: 'g', category: weight },
      { name: 'kg', category: weight },
      { name: 'l', category: { name: 'volume', measureUnits: [] } },
      { name: 'orphan' },
    ]);
    expect(units[3]).not.toHaveProperty('category');
  }

  /** A tally streams with each row, read by the row's own statement. */
  async shouldStreamACount() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'streamed count' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'a', categoryId },
      { name: 'b', categoryId },
    ]);

    const streamed = await Array.fromAsync(
      this.querier.findManyStream(MeasureUnitCategory, {
        $select: { name: true },
        $where: { id: categoryId },
        $count: { measureUnits: true },
      }),
    );

    expect(streamed).toEqual([{ name: 'streamed count', _count: { measureUnits: 2 } }]);
  }

  /** A filter narrows what counts, without touching which parents come back. */
  async shouldCountARelationThroughAFilter() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'filtered category' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'keep', categoryId },
      { name: 'keep', categoryId },
      { name: 'drop', categoryId },
    ]);

    const [found] = await this.querier.findMany(MeasureUnitCategory, {
      $where: { name: 'filtered category' },
      $count: { measureUnits: { $where: { name: 'keep' } } },
    });

    expect(found._count.measureUnits).toBe(2);
  }

  /** A many-to-many counts its junction rows, one per pairing. */
  async shouldCountAManyToManyRelation() {
    const id = await this.querier.insertOne(Item, {
      name: 'counted item',
      createdAt: 1,
      tags: [
        { name: 'tag one', createdAt: 1 },
        { name: 'tag two', createdAt: 1 },
      ],
    });

    const [found] = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { id },
      $count: { tags: true },
    });

    expect(found._count.tags).toBe(2);
  }

  /** Filtering a many-to-many names the target's columns, which the junction does not have. */
  async shouldCountAManyToManyRelationThroughAFilter() {
    const id = await this.querier.insertOne(Item, {
      name: 'filtered item',
      createdAt: 1,
      tags: [
        { name: 'keep me', createdAt: 1 },
        { name: 'drop me', createdAt: 1 },
      ],
    });

    const [found] = await this.querier.findMany(Item, {
      $where: { id },
      $count: { tags: { $where: { name: 'keep me' } } },
    });

    expect(found._count.tags).toBe(1);
  }

  /** Counting a relation and populating the same one are independent: rows *and* the total. */
  async shouldCountAndPopulateTheSameRelation() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'both category' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'a unit', categoryId },
      { name: 'b unit', categoryId },
      { name: 'c unit', categoryId },
    ]);

    const [found] = await this.querier.findMany(MeasureUnitCategory, {
      $where: { name: 'both category' },
      $populate: { measureUnits: { $select: { name: true }, $sort: { name: 1 }, $limit: 2 } },
      $count: { measureUnits: true },
    });

    expect(found.measureUnits?.map(({ name }) => name)).toEqual(['a unit', 'b unit']);
    expect(found._count.measureUnits).toBe(3);
  }

  /** A computed field of a populated to-many is read inside the parent's statement, as its own read reads it. */
  async shouldReadAComputedFieldOfAPopulatedToMany() {
    const id = await this.querier.insertOne(Item, {
      name: 'tagged item',
      createdAt: 1,
      tags: [
        { name: 'own tag', createdAt: 1 },
        { name: 'shared tag', createdAt: 1 },
      ],
    });
    const otherId = await this.querier.insertOne(Item, { name: 'other item', createdAt: 1 });
    const shared = await this.querier.findOne(Tag, { $select: { id: true }, $where: { name: 'shared tag' } });
    assertDefined(shared);
    await this.querier.insertOne(ItemTag, { itemId: otherId, tagId: shared.id });

    const found = await this.querier.findOneById(Item, id, {
      $select: { name: true },
      $populate: { tags: { $select: { name: true, itemsCount: true }, $sort: { name: 1 } } },
    });

    expect(found).toMatchObject({
      tags: [
        { name: 'own tag', itemsCount: 1 },
        { name: 'shared tag', itemsCount: 2 },
      ],
    });
  }

  /** The inverse side of a many-to-many counts the same junction rows, from the other end. */
  async shouldCountAnInverseManyToManyRelation() {
    await this.querier.insertOne(Item, {
      name: 'inverse item',
      createdAt: 1,
      tags: [{ name: 'shared tag', createdAt: 1 }],
    });

    const [found] = await this.querier.findMany(Tag, {
      $select: { name: true },
      $where: { name: 'shared tag' },
      $count: { items: true },
    });

    expect(found._count.items).toBe(1);
  }

  /**
   * Ordering a to-many relation's own rows: `$sort` inside `$populate` orders the children's own read,
   * which is where "each parent with its children in order" lives. The parent-level `$sort` cannot
   * express it: it orders parents, and a parent has many children.
   */
  async shouldPopulateToManySortedByItsOwnField() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'Sorted category' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'zulu unit', categoryId },
      { name: 'alpha unit', categoryId },
    ]);

    const [found] = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $where: { name: 'Sorted category' },
      $populate: { measureUnits: { $select: { name: true }, $sort: { name: 1 } } },
    });

    expect(found.measureUnits?.map(({ name }) => name)).toEqual(['alpha unit', 'zulu unit']);
  }

  /** A populated relation's own `$sort` places nulls too, inside the statement that reads its rows. */
  async shouldPopulateToManySortedByNullPlacement() {
    const id = await this.querier.insertOne(InventoryAdjustment, {
      description: 'placed adjustment',
      itemAdjustments: [
        { number: 1, buyPrice: 7 },
        { number: 2, buyPrice: null },
        { number: 3, buyPrice: 9 },
      ],
    });

    const found = await this.querier.findOneById(InventoryAdjustment, id, {
      $select: { id: true },
      $populate: { itemAdjustments: { $select: { number: true }, $sort: { buyPrice: 'ascNullsLast' } } },
    });

    expect(found?.itemAdjustments?.map(({ number }) => number)).toEqual([1, 3, 2]);
  }

  /**
   * A `$limit` inside a to-many is each parent's own: every parent gets its own first rows rather than a
   * share of one page, `$skip` pages each apart, and a parent with fewer keeps what it has.
   */
  async shouldPageAToManyPerParent() {
    const [a, b, thin] = await this.querier.insertMany(MeasureUnitCategory, [
      { name: 'paged a' },
      { name: 'paged b' },
      { name: 'paged thin' },
      { name: 'paged without' },
    ]);
    await this.querier.insertMany(MeasureUnit, [
      ...[1, 2, 3, 4].map((n) => ({ name: `a${n}`, categoryId: a })),
      ...[1, 2, 3, 4].map((n) => ({ name: `b${n}`, categoryId: b })),
      { name: 'thin1', categoryId: thin },
    ]);
    const pageOf = async ($skip: number) => {
      const founds = await this.querier.findMany(MeasureUnitCategory, {
        $select: { name: true },
        $where: { name: { $startsWith: 'paged ' } },
        $sort: { name: 1 },
        $populate: { measureUnits: { $select: { name: true }, $sort: { name: -1 }, $limit: 2, $skip } },
      });
      return founds.map(({ name, measureUnits }) => [name, measureUnits?.map((unit) => unit.name)]);
    };

    expect(await pageOf(0)).toEqual([
      ['paged a', ['a4', 'a3']],
      ['paged b', ['b4', 'b3']],
      ['paged thin', ['thin1']],
      ['paged without', []],
    ]);
    expect(await pageOf(2)).toEqual([
      ['paged a', ['a2', 'a1']],
      ['paged b', ['b2', 'b1']],
      ['paged thin', []],
      ['paged without', []],
    ]);
  }

  /** A many-to-many is paged per parent too, over the targets its junction pairs each one with. */
  async shouldPageAManyToManyPerParent() {
    await this.querier.insertMany(Item, [
      { name: 'tagged first', tags: [{ name: 'x' }, { name: 'y' }, { name: 'z' }] },
      { name: 'tagged second', tags: [{ name: 'x' }, { name: 'y' }, { name: 'z' }] },
    ]);

    const founds = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { name: { $startsWith: 'tagged ' } },
      $sort: { name: 1 },
      $populate: { tags: { $select: { name: true }, $sort: { name: 1 }, $limit: 2 } },
    });

    expect(founds.map(({ name, tags }) => [name, tags?.map((tag) => tag.name)])).toEqual([
      ['tagged first', ['x', 'y']],
      ['tagged second', ['x', 'y']],
    ]);
  }

  /** `$distinct` collapses rows that agree on every projected column, as `SELECT DISTINCT` does, on every backend. */
  async shouldFindDistinctRows() {
    await this.querier.insertMany(Item, [
      { name: 'dup', code: 'd1' },
      { name: 'dup', code: 'd2' },
      { name: 'uniq', code: 'u1' },
    ]);

    const founds = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { name: { $in: ['dup', 'uniq'] } },
      $distinct: true,
      $sort: { name: 1 },
    });

    expect(founds.map(({ name }) => name)).toEqual(['dup', 'uniq']);
  }

  /**
   * A page on a write picks which rows it touches, so it has to settle them with a read first: no
   * engine but MySQL takes `LIMIT` on an UPDATE or a DELETE, and MongoDB takes neither.
   */
  async shouldUpdateOnlyThePagedRows() {
    await this.querier.insertMany(Item, [
      { name: 'paged c', code: '3' },
      { name: 'paged a', code: '1' },
      { name: 'paged b', code: '2' },
    ]);

    const changes = await this.querier.updateMany(
      Item,
      { $where: { name: { $startsWith: 'paged ' } }, $sort: { code: 1 }, $limit: 1 },
      { name: 'touched' },
    );

    expect(changes).toBe(1);
    const founds = await this.querier.findMany(Item, { $select: { name: true }, $sort: { code: 1 } });
    expect(founds.map(({ name }) => name)).toEqual(['touched', 'paged b', 'paged c']);
  }

  /**
   * An ordering with no page reorders the same set, so the write still touches every match. It is
   * the reason `isPagedQuery` counts a bare `$sort`: the SQL dialects emit it on the UPDATE
   * itself, and SQLite rejects an `ORDER BY` there without a `LIMIT`, so the rows have to be settled
   * and named instead.
   */
  async shouldUpdateEveryMatchWhenOnlySorted() {
    await this.querier.insertMany(Item, [
      { name: 'sorted c', code: '3' },
      { name: 'sorted a', code: '1' },
    ]);

    const changes = await this.querier.updateMany(
      Item,
      { $where: { name: { $startsWith: 'sorted ' } }, $sort: { code: 1 } },
      { name: 'touched' },
    );

    expect(changes).toBe(2);
    const founds = await this.querier.findMany(Item, { $select: { name: true } });
    expect(founds.map(({ name }) => name)).toEqual(['touched', 'touched']);
  }

  async shouldDeleteOnlyThePagedRows() {
    await this.querier.insertMany(Item, [
      { name: 'paged c', code: '3' },
      { name: 'paged a', code: '1' },
      { name: 'paged b', code: '2' },
    ]);

    const changes = await this.querier.deleteMany(Item, {
      $where: { name: { $startsWith: 'paged ' } },
      $sort: { code: 1 },
      $limit: 1,
    });

    expect(changes).toBe(1);
    const founds = await this.querier.findMany(Item, { $select: { name: true }, $sort: { code: 1 } });
    expect(founds.map(({ name }) => name)).toEqual(['paged b', 'paged c']);
  }

  /**
   * Ordering by a field of a to-one, under the column the related entity names, with or without a
   * `$populate`: each backend brings the relation in itself (a join on SQL, a `$lookup` on MongoDB), and
   * the populated read is the same order, unwidened only when nothing was asked for.
   */
  async shouldFindManySortedByRelationField() {
    const [zulu, alpha] = await Promise.all([
      this.querier.insertOne(Tax, { name: 'Zulu tax', percentage: 1 }),
      this.querier.insertOne(Tax, { name: 'Alpha tax', percentage: 2 }),
    ]);
    await this.querier.insertMany(Item, [
      { name: 'sorted by zulu', taxId: zulu },
      { name: 'sorted by alpha', taxId: alpha },
    ]);
    const q = {
      $select: { name: true },
      $where: { name: { $startsWith: 'sorted by ' } },
      $sort: { tax: { name: 1 } },
    } as const;

    const unpopulated = await this.querier.findMany(Item, q);
    expect(unpopulated).toEqual([{ name: 'sorted by alpha' }, { name: 'sorted by zulu' }]);

    const populated = await this.querier.findMany(Item, { ...q, $populate: { tax: { $select: { name: true } } } });
    expect(populated.map(({ name }) => name)).toEqual(['sorted by alpha', 'sorted by zulu']);
  }

  /**
   * Boolean and numeric operands against a JSON dot-path compare as their own type, where a text
   * extraction raises `text = boolean` on typed drivers and matches nothing on MySQL.
   */
  async shouldFindByJsonDotPathTypedOperands() {
    await this.querier.insertOne(Company, { name: 'JSON Typed On', kind: { isArchived: true, public: 1 } });
    await this.querier.insertOne(Company, { name: 'JSON Typed Off', kind: { isArchived: false, public: 0 } });

    expect(await this.companyNames({ 'kind.isArchived': true })).toEqual(['JSON Typed On']);
    expect(await this.companyNames({ 'kind.isArchived': { $ne: true } })).toEqual(['JSON Typed Off']);
    expect(await this.companyNames({ 'kind.public': { $in: [1] } })).toEqual(['JSON Typed On']);
    expect(await this.companyNames({ 'kind.public': { $in: [0, 1] } })).toEqual(['JSON Typed Off', 'JSON Typed On']);
  }

  /**
   * A field compares with another column of its row as with a value, and a JSON path with a column reads the
   * path as that column's type: the same rows on every engine, a read and an aggregate's `$where` alike.
   */
  async shouldCompareAFieldWithAnotherColumn() {
    await this.querier.insertMany(Reading, [
      { name: 'rising', low: 1, high: 2, open: true, doc: { score: 2, name: 'rising', open: true } },
      { name: 'flat', low: 2, high: 2, open: false, doc: { score: 3, name: 'other', open: true } },
      { name: 'unbounded', low: 1, high: null, open: null, doc: { score: 9, name: 'x', open: false } },
    ]);
    const reading = refs(Reading);

    expect(await this.readingNames({ high: { $gt: reading.low } })).toEqual(['rising']);
    expect(await this.readingNames({ low: { $between: [reading.low, reading.high] } })).toEqual(['flat', 'rising']);
    expect(await this.readingNames({ low: { $in: [5, reading.high] } })).toEqual(['flat']);
    expect(await this.readingNames({ high: reading.low })).toEqual(['flat']);
    expect(await this.readingNames({ 'doc.score': { $eq: reading.high } })).toEqual(['rising']);
    expect(await this.readingNames({ 'doc.name': { $eq: reading.name } })).toEqual(['rising']);
    expect(await this.readingNames({ 'doc.open': { $eq: reading.open } })).toEqual(['rising']);
  }

  /** A fractional operand against a JSON number compares as a fraction, on a path and inside `$elemMatch`. */
  async shouldFindByJsonDotPathFraction() {
    await this.querier.insertOne(Company, { name: 'JSON Rated Low', kind: { rating: 1.4, items: [{ count: 1.4 }] } });
    await this.querier.insertOne(Company, { name: 'JSON Rated High', kind: { rating: 2.6, items: [{ count: 2.6 }] } });

    expect(await this.companyNames({ 'kind.rating': { $gt: 1.2 } })).toEqual(['JSON Rated High', 'JSON Rated Low']);
    expect(await this.companyNames({ 'kind.rating': { $lt: 1.5 } })).toEqual(['JSON Rated Low']);
    expect(await this.companyNames({ 'kind.rating': 1.4 })).toEqual(['JSON Rated Low']);
    expect(await this.companyNames({ 'kind.rating': { $in: [2.6] } })).toEqual(['JSON Rated High']);
    expect(await this.companyNames({ 'kind.rating': { $between: [1.3, 1.5] } })).toEqual(['JSON Rated Low']);
    expect(await this.companyNames({ 'kind.items': { $elemMatch: { count: { $gt: 1.5 } } } })).toEqual([
      'JSON Rated High',
    ]);
    expect(await this.companyNames({ 'kind.rating': { $not: { $gt: 2 } } })).toEqual(['JSON Rated Low']);
  }

  /** An element's field compared with a column of the row holding the array: the ref reads the column, never `{}`. */
  async shouldMatchAJsonElementAgainstAColumnRef() {
    await this.querier.insertOne(Company, { name: 'Echo', kind: { items: [{ name: 'Echo' }] } });
    await this.querier.insertOne(Company, { name: 'Other', kind: { items: [{ name: 'Echo' }] } });

    expect(await this.companyNames({ 'kind.items': { $elemMatch: { name: refs(Company).name } } })).toEqual(['Echo']);
  }

  /**
   * An object element is contained where it holds the given keys, nested ones too, and its other keys do
   * not matter: `$all` and `$elemMatch` mean the same on every engine, with an operator beside them or not.
   */
  async shouldMatchAJsonArrayElementByContainment() {
    await this.querier.insertMany(Company, [
      {
        name: 'JSON Contained',
        kind: {
          items: [{ name: 'first', active: true }],
          meta: { list: [{ tag: { key: 'a', size: 1 }, n: 2, labels: ['x', 'y'] }], grid: [[1, 2, 3]] },
        },
      },
      {
        name: 'JSON Not Contained',
        kind: {
          items: [{ name: 'second' }],
          meta: { list: [{ tag: { key: 'b' }, n: 3, labels: ['x'] }], grid: [[1, 3]] },
        },
      },
    ]);

    expect(await this.companyNames({ 'kind.items': { $all: [{ name: 'first' }] } })).toEqual(['JSON Contained']);
    expect(await this.companyNames({ 'kind.meta.list': { $all: [{ tag: { key: 'a' } }] } })).toEqual([
      'JSON Contained',
    ]);
    expect(await this.companyNames({ 'kind.meta.grid': { $all: [[2, 1]] } })).toEqual(['JSON Contained']);
    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { tag: { key: 'a' } } } })).toEqual([
      'JSON Contained',
    ]);
    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { labels: ['y'] } } })).toEqual([
      'JSON Contained',
    ]);
    expect(
      await this.companyNames({
        'kind.meta.list': { $elemMatch: { tag: { key: 'a' }, labels: ['y'], n: { $gt: 1 } } },
      }),
    ).toEqual(['JSON Contained']);
    expect(
      await this.companyNames({ 'kind.meta.list': { $elemMatch: { tag: { key: { $in: ['a', 'c'] } } } } }),
    ).toEqual(['JSON Contained']);
  }

  /** A path holding a scalar or an object has no elements: no array operator matches it, and none fails the read. */
  async shouldMatchNoArrayOperatorOnANonArrayPath() {
    await this.querier.insertMany(Company, [
      { name: 'JSON List Scalar', kind: { meta: { list: 5 } } },
      { name: 'JSON List Object', kind: { meta: { list: { k: 5 } } } },
      { name: 'JSON List Array', kind: { meta: { list: [5], none: [] } } },
    ]);

    expect(await this.companyNames({ 'kind.meta.list': { $size: 1 } })).toEqual(['JSON List Array']);
    expect(
      await this.companyNames({
        'kind.meta.list': { $size: { $lte: 2 }, $elemMatch: { $eq: 5 } },
        'kind.meta.none': { $size: { $lt: 1 } },
      }),
    ).toEqual(['JSON List Array']);
    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { $gt: 1 } } })).toEqual(['JSON List Array']);
    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { $eq: 5 } } })).toEqual(['JSON List Array']);
    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { $in: [5, 6] } } })).toEqual(['JSON List Array']);
  }

  /**
   * A JSON number compares and sorts as a number, and an array element matches only its own type,
   * whatever other rows hold at the same path.
   */
  async shouldCompareAJsonPathAcrossTypes() {
    await this.querier.insertMany(Company, [
      { name: 'JSON Mixed Ten', kind: { meta: { score: 10, list: ['1'] } } },
      { name: 'JSON Mixed Nine', kind: { meta: { score: 9, list: [1] } } },
      { name: 'JSON Mixed Text', kind: { meta: { score: 'abc', list: [true] } } },
    ]);

    const byScore = await this.querier.findMany(Company, {
      $where: { 'kind.meta.score': { $gt: 1 } },
      $sort: { 'kind.meta.score': 1 },
    });
    expect(byScore.map(({ name }) => name)).toEqual(['JSON Mixed Nine', 'JSON Mixed Ten']);
    expect(await this.companyNames({ 'kind.meta.score': { $gt: 1 } })).toEqual(['JSON Mixed Nine', 'JSON Mixed Ten']);

    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { $eq: 1 } } })).toEqual(['JSON Mixed Nine']);
    expect(await this.companyNames({ 'kind.meta.list': { $elemMatch: { $in: ['1', 'x'] } } })).toEqual([
      'JSON Mixed Ten',
    ]);
    expect(await this.companyNames({ 'kind.meta.list': { $all: [true] } })).toEqual(['JSON Mixed Text']);
  }

  /** A JSON null is an element like any other: `$all` finds the array holding one, and no other. */
  async shouldFindAJsonArrayHoldingNull() {
    await this.querier.insertMany(Company, [
      { name: 'JSON Holds Null', kind: { meta: { list: [null, 1] } } },
      { name: 'JSON Holds None', kind: { meta: { list: [1] } } },
    ]);

    expect(await this.companyNames({ 'kind.meta.list': { $all: [null] } })).toEqual(['JSON Holds Null']);
  }

  /**
   * `$elemMatch` over object elements, as containment and with per-field operators, each field compared
   * as its own type.
   */
  async shouldFindByJsonElemMatch() {
    await this.querier.insertOne(Company, {
      name: 'JSON Elem Active',
      kind: { items: [{ name: 'first', active: true }] },
    });
    await this.querier.insertOne(Company, {
      name: 'JSON Elem Idle',
      kind: { items: [{ name: 'second', active: false }] },
    });

    expect(await this.companyNames({ 'kind.items': { $elemMatch: { name: 'first' } } })).toEqual(['JSON Elem Active']);
    expect(await this.companyNames({ 'kind.items': { $elemMatch: { active: { $eq: true } } } })).toEqual([
      'JSON Elem Active',
    ]);
    expect(
      await this.companyNames({
        'kind.items': { $elemMatch: { active: { $eq: false }, name: { $startsWith: 'sec' } } },
      }),
    ).toEqual(['JSON Elem Idle']);
  }

  /**
   * `$elemMatch` edge shapes: plain equality agrees with its `$eq` spelling, a null field is a null check
   * rather than `= NULL`, and an operator applies to a scalar element itself.
   */
  async shouldFindByJsonElemMatchEdgeShapes() {
    await this.querier.insertOne(Company, {
      name: 'JSON Edge Counted',
      kind: { items: [{ name: 'a', count: 5, note: null }], flags: [true] },
    });
    await this.querier.insertOne(Company, {
      name: 'JSON Edge Other',
      kind: { items: [{ name: 'b', count: 9, note: 'set' }], flags: [false] },
    });

    expect(await this.companyNames({ 'kind.items': { $elemMatch: { count: 5 } } })).toEqual(['JSON Edge Counted']);
    expect(await this.companyNames({ 'kind.items': { $elemMatch: { count: { $eq: 5 } } } })).toEqual([
      'JSON Edge Counted',
    ]);
    expect(await this.companyNames({ 'kind.items': { $elemMatch: { note: null } } })).toEqual(['JSON Edge Counted']);
    expect(await this.companyNames({ 'kind.flags': { $elemMatch: { $eq: true } } })).toEqual(['JSON Edge Counted']);
  }

  /**
   * `$size`/`$all`/`$elemMatch` on a JSON dot-path, on every engine: MariaDB takes no `col->'key'`, and
   * SQLite's `$all` matches a string element.
   */
  async shouldFindByJsonDotPathArrayOperators() {
    await this.querier.insertOne(Company, { name: 'JSON Path Two', kind: { tags: ['a', 'b'], ranks: [1, 2] } });
    await this.querier.insertOne(Company, { name: 'JSON Path One', kind: { tags: ['c'], ranks: [3] } });

    expect(await this.companyNames({ 'kind.tags': { $size: 2 } })).toEqual(['JSON Path Two']);
    expect(await this.companyNames({ 'kind.tags': { $all: ['b', 'a'] } })).toEqual(['JSON Path Two']);
    expect(await this.companyNames({ 'kind.tags': { $all: ['absent'] } })).toEqual([]);
    expect(await this.companyNames({ 'kind.tags': { $elemMatch: { $eq: 'b' } } })).toEqual(['JSON Path Two']);
    expect(await this.companyNames({ 'kind.tags': { $elemMatch: { $in: ['c', 'z'] } } })).toEqual(['JSON Path One']);
    expect(await this.companyNames({ 'kind.ranks': { $elemMatch: { $eq: 2 } } })).toEqual(['JSON Path Two']);
    expect(await this.companyNames({ 'kind.ranks': { $elemMatch: { $in: [3, 9] } } })).toEqual(['JSON Path One']);
  }

  /** `$addToSet` appends only an element the array lacks, creates an absent one, and composes with other keys. */
  async shouldAddToSetOnlyAnAbsentElement() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Add To Set',
      kind: { public: 1, tags: ['a', 'b'], ranks: [1] },
    });

    await this.querier.updateOneById(Company, id, { kind: { $addToSet: { tags: 'a', ranks: 2 } } });
    let found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, tags: ['a', 'b'], ranks: [1, 2] });

    await this.querier.updateOneById(Company, id, {
      kind: { $addToSet: { tags: 'c', labels: 'x' }, $set: { private: 1 }, $unset: ['public'] },
    });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ private: 1, tags: ['a', 'b', 'c'], ranks: [1, 2], labels: ['x'] });

    // Beside a nested `$set`, which MongoDB writes as a pipeline.
    await this.querier.updateOneById(Company, id, {
      kind: { $addToSet: { tags: 'a', labels: 'y' }, $set: { 'theme.color': 'red' } },
    });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({
      private: 1,
      tags: ['a', 'b', 'c'],
      ranks: [1, 2],
      labels: ['x', 'y'],
      theme: { color: 'red' },
    });
  }

  /**
   * A dotted `$set` writes one nested value, keeping its siblings, and creates each parent that is absent,
   * NULL, or no object, a NULL column included.
   */
  async shouldSetANestedJsonPath() {
    const ids = await this.querier.insertMany(LooseDoc, [
      { name: 'JSON Nested Kept', doc: { public: 1, theme: { color: 'red', size: 2 } } },
      { name: 'JSON Nested Absent', doc: { public: 1 } },
      { name: 'JSON Nested Scalar', doc: { public: 1, theme: 'dark' } },
      { name: 'JSON Nested Array', doc: { public: 1, theme: [{ color: 'red' }] } },
      { name: 'JSON Nested Null', doc: null },
    ]);

    await this.querier.updateMany(
      LooseDoc,
      { $where: { id: ids } },
      { doc: { $set: { 'theme.color': 'blue', 'meta.a.b': 1 } } },
    );

    expect(await this.namedDocs(ids)).toEqual([
      ['JSON Nested Absent', { public: 1, theme: { color: 'blue' }, meta: { a: { b: 1 } } }],
      ['JSON Nested Array', { public: 1, theme: { color: 'blue' }, meta: { a: { b: 1 } } }],
      ['JSON Nested Kept', { public: 1, theme: { color: 'blue', size: 2 }, meta: { a: { b: 1 } } }],
      ['JSON Nested Null', { theme: { color: 'blue' }, meta: { a: { b: 1 } } }],
      ['JSON Nested Scalar', { public: 1, theme: { color: 'blue' }, meta: { a: { b: 1 } } }],
    ]);
  }

  /** A dotted `$set` stores a JSON null, keeping the rest of the document. */
  async shouldSetANullAtANestedJsonPath() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Nested Null Leaf',
      kind: { public: 1, theme: { color: 'red', size: 2 } },
    });

    await this.querier.updateOneById(Company, id, { kind: { $set: { 'theme.color': null } } });

    expect(await this.kindOf(id)).toEqual({ public: 1, theme: { color: null, size: 2 } });
  }

  /**
   * `$addToSet` creates the array where the key is absent, null or the column NULL, and leaves a value that
   * is no array as it is.
   */
  async shouldAddToSetOnAnythingButAnArray() {
    const ids = await this.querier.insertMany(LooseDoc, [
      { name: 'JSON Add To Set Null Key', doc: { public: 1, tags: null } },
      { name: 'JSON Add To Set Null Column', doc: null },
      { name: 'JSON Add To Set Scalar', doc: { public: 1, tags: 'x' } },
    ]);

    await this.querier.updateMany(LooseDoc, { $where: { id: ids } }, { doc: { $addToSet: { tags: 'a' } } });

    expect(await this.namedDocs(ids)).toEqual([
      ['JSON Add To Set Null Column', { tags: ['a'] }],
      ['JSON Add To Set Null Key', { public: 1, tags: ['a'] }],
      ['JSON Add To Set Scalar', { public: 1, tags: 'x' }],
    ]);
  }

  /** A dotted `$unset` removes one nested key, keeping its siblings, and leaves an absent one, or one under a scalar, as it is. */
  async shouldUnsetANestedJsonPath() {
    const ids = await this.querier.insertMany(LooseDoc, [
      { name: 'JSON Nested Unset Object', doc: { public: 1, theme: { color: 'red', size: 2 } } },
      { name: 'JSON Nested Unset Scalar', doc: { public: 1, theme: 'dark' } },
    ]);

    await this.querier.updateMany(
      LooseDoc,
      { $where: { id: ids } },
      { doc: { $unset: ['theme.color', 'meta.absent'] } },
    );

    expect(await this.namedDocs(ids)).toEqual([
      ['JSON Nested Unset Object', { public: 1, theme: { size: 2 } }],
      ['JSON Nested Unset Scalar', { public: 1, theme: 'dark' }],
    ]);
  }

  /**
   * `$pull` and `$push` on the same key in one payload: the pull applies to the stored array, and the push
   * appends to what the pull left.
   */
  async shouldCombineJsonOperatorsOnSameKey() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Combined',
      kind: { public: 1, tags: ['a', 'b', 'a'] },
    });

    const result = await this.querier.updateOneById(Company, id, {
      kind: { $pull: { tags: 'a' }, $push: { tags: 'fresh' }, $set: { private: 1 }, $unset: ['public'] },
    });
    expect(result).toBe(1);

    expect(await this.kindOf(id)).toEqual({ private: 1, tags: ['b', 'fresh'] });
  }

  /** `$set` and `$push` on the same key: the set replaces the array, the push appends to that result. */
  async shouldCombineJsonSetAndPushOnSameKey() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Set Push',
      kind: { public: 1, tags: ['stale'] },
    });

    const result = await this.querier.updateOneById(Company, id, {
      kind: { $set: { tags: ['kept'] }, $push: { tags: 'appended' } },
    });
    expect(result).toBe(1);

    expect(await this.kindOf(id)).toEqual({ public: 1, tags: ['kept', 'appended'] });
  }

  /** `$set` and `$unset` on the same key: `$unset` is applied last, so the key ends up removed. */
  async shouldApplyJsonUnsetAfterSetOnSameKey() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Set Unset',
      kind: { public: 1 },
    });

    await this.querier.updateOneById(Company, id, {
      kind: { $set: { private: 1, country: 'US' }, $unset: ['private'] },
    });

    expect(await this.kindOf(id)).toEqual({ public: 1, country: 'US' });
  }

  /** Operators naming one value, or one inside another, apply in order: `$pull`, `$set`, `$push`, `$addToSet`, `$unset`. */
  async shouldApplyJsonOperatorsOnOneValueInOrder() {
    const [readded, kept, merged, removed, appended, created] = await this.querier.insertMany(LooseDoc, [
      { name: 'JSON Order 1 Readded', doc: { tags: ['a', 'b'] } },
      { name: 'JSON Order 2 Kept', doc: { tags: ['a', 'b'] } },
      { name: 'JSON Order 3 Merged', doc: { theme: { color: 'red', size: 1 } } },
      { name: 'JSON Order 4 Removed', doc: { public: 1, theme: { color: 'red' } } },
      { name: 'JSON Order 5 Appended', doc: { tags: ['a'] } },
      { name: 'JSON Order 6 Created', doc: { tags: null } },
    ]);
    const update = (id: LooseDoc['id'], doc: JsonUpdateOp) => this.querier.updateOneById(LooseDoc, id, { doc });

    await update(readded, { $pull: { tags: 'a' }, $addToSet: { tags: 'a' } });
    await update(kept, { $pull: { tags: 'a' }, $addToSet: { tags: 'b' } });
    await update(merged, { $set: { theme: { color: 'blue' }, 'theme.size': 2 } });
    await update(removed, { $set: { 'theme.color': 'blue' }, $unset: ['theme'] });
    await update(appended, { $push: { tags: 'x' }, $addToSet: { tags: 'x' } });
    await update(created, { $pull: { tags: 'a' }, $push: { tags: 'z' } });

    expect(await this.namedDocs([readded, kept, merged, removed, appended, created])).toEqual([
      ['JSON Order 1 Readded', { tags: ['b', 'a'] }],
      ['JSON Order 2 Kept', { tags: ['b'] }],
      ['JSON Order 3 Merged', { theme: { color: 'blue', size: 2 } }],
      ['JSON Order 4 Removed', { public: 1 }],
      ['JSON Order 5 Appended', { tags: ['a', 'x'] }],
      ['JSON Order 6 Created', { tags: ['z'] }],
    ]);
  }

  /** A null element is JSON's null to `$pull`, `$push` and `$addToSet`, never SQL's NULL. */
  async shouldTreatANullElementAsJsonNull() {
    const id = await this.querier.insertOne(Company, { name: 'JSON Null Element', kind: { notes: ['a', null, 'b'] } });

    await this.querier.updateOneById(Company, id, { kind: { $pull: { notes: null } } });
    let found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ notes: ['a', 'b'] });

    await this.querier.updateOneById(Company, id, { kind: { $push: { notes: null } } });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ notes: ['a', 'b', null] });
  }

  /**
   * `$push` creates the array where the key is absent, holds null, or the column is NULL, as `$set` would
   * create the document, and it appends to an array already there.
   */
  async shouldPushOntoAnAbsentOrNullJsonValue() {
    const ids = await this.querier.insertMany(LooseDoc, [
      { name: 'JSON Push Null Key', doc: { notes: null } },
      { name: 'JSON Push Null Column', doc: null },
      { name: 'JSON Push Missing Key', doc: { public: 1 } },
    ]);

    await this.querier.updateMany(LooseDoc, { $where: { id: ids } }, { doc: { $push: { notes: 'a' } } });

    expect(await this.namedDocs(ids)).toEqual([
      ['JSON Push Missing Key', { public: 1, notes: ['a'] }],
      ['JSON Push Null Column', { notes: ['a'] }],
      ['JSON Push Null Key', { notes: ['a'] }],
    ]);
  }

  /** A `$set` of `undefined` writes nothing, on every engine, as the key it names were absent. */
  async shouldOmitAnUndefinedJsonSetValue() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Undefined Set',
      kind: { public: 1, tags: ['keep'] },
    });

    await this.querier.updateOneById(Company, id, { kind: { $set: { tags: undefined, private: 1 } } });

    expect(await this.kindOf(id)).toEqual({ public: 1, tags: ['keep'], private: 1 });
  }

  /** A `$unset` naming one key twice removes it, as naming it once does. */
  async shouldUnsetTheSameJsonKeyTwice() {
    const id = await this.querier.insertOne(Company, { name: 'JSON Unset Twice', kind: { public: 1, private: 1 } });

    await this.querier.updateOneById(Company, id, { kind: { $unset: ['public', 'public'] } });

    expect(await this.kindOf(id)).toEqual({ private: 1 });
  }

  /** A `$pull` alone leaves a NULL document NULL, as SQL does, on every engine. */
  async shouldPullFromANullJsonColumnAsNoop() {
    const id = await this.querier.insertOne(Company, { name: 'JSON Pull Null Column', kind: null });

    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'a' } } });

    const kind = await this.kindOf(id);
    expect(kind == null).toBe(true);
  }

  /** Many array keys in one update all land, the statement staying linear in their number. */
  async shouldPushOntoManyJsonKeysInOneUpdate() {
    const keys = Array.from({ length: 24 }, (_, index) => `list${index}`);
    const id = await this.querier.insertOne(Company, { name: 'JSON Many Keys', kind: { public: 1 } });
    const push = Object.fromEntries(keys.map((key) => [key, 'a']));

    await this.querier.updateOneById(Company, id, { kind: { $push: push } });

    const expected = Object.fromEntries(keys.map((key) => [key, ['a']]));
    expect(await this.kindOf(id)).toEqual({ public: 1, ...expected });
  }

  /**
   * On a JSON array column the operators take lists of elements, applied in order: `$pull` each, then `$push`
   * each, then `$addToSet` each the array lacks. A NULL column counts as an empty array.
   */
  async shouldUpdateAJsonArrayColumn() {
    await this.querier.insertMany(JsonRecord, [
      { id: 1, entries: ['a', 'b', 'c', 'b'] },
      { id: 2, entries: null },
      { id: 3, entries: [] },
    ]);

    await this.querier.updateMany(
      JsonRecord,
      { $where: { id: [1, 2, 3] } },
      { entries: { $pull: ['b', 'x'], $push: ['d', 'd'], $addToSet: ['a', 'e', 'e', 'c'] } },
    );

    expect(await this.querier.findMany(JsonRecord, { $sort: { id: 'asc' } })).toEqual([
      { id: 1, entries: ['a', 'c', 'd', 'd', 'e'] },
      { id: 2, entries: ['d', 'd', 'a', 'e', 'c'] },
      { id: 3, entries: ['d', 'd', 'a', 'e', 'c'] },
    ]);
  }

  /** Elements compare by type as well as value, as in JavaScript: `true`, `1` and `'1'` are three elements. */
  async shouldCompareJsonArrayElementsByType() {
    await this.querier.insertOne(JsonRecord, { id: 1, entries: [1, 'a'] });

    await this.querier.updateOneById(JsonRecord, 1, {
      entries: { $pull: [true, '1'], $addToSet: [1, 'a', true, '1'] },
    });

    expect(await this.querier.findOneById(JsonRecord, 1)).toEqual({ id: 1, entries: [1, 'a', true, '1'] });
  }

  /** A JSON array column's elements may be objects or arrays. */
  async shouldUpdateAJsonArrayColumnOfObjects() {
    await this.querier.insertOne(JsonRecord, { id: 1, entries: [{ by: 'ada' }, { by: 'linus' }, ['x']] });

    await this.querier.updateOneById(JsonRecord, 1, {
      entries: { $pull: [{ by: 'linus' }, ['x']], $push: [{ by: 'grace', tags: ['x'] }] },
    });

    expect(await this.querier.findOneById(JsonRecord, 1)).toEqual({
      id: 1,
      entries: [{ by: 'ada' }, { by: 'grace', tags: ['x'] }],
    });
  }

  /** Array operators leave a stored value that is no array as it is, a string or an object, as on an array key. */
  async shouldLeaveAStoredValueThatIsNoArray() {
    await this.querier.insertMany(JsonValue, [
      { position: 1, value: 'x' },
      { position: 2, value: { a: 1 } },
      { position: 3, value: ['a'] },
    ]);

    await this.querier.updateMany(JsonValue, { $where: { position: [1, 2, 3] } }, { value: { $push: ['b'] } });

    const read = await this.querier.findMany(JsonValue, { $select: { value: true }, $sort: { position: 'asc' } });
    expect(read.map((row) => row.value)).toEqual(['x', { a: 1 }, ['a', 'b']]);
  }

  /** Many dotted paths in one update all land, their parents created alike. */
  async shouldSetManyNestedJsonPathsInOneUpdate() {
    const parents = Array.from({ length: 24 }, (_, index) => `p${index}`);
    const id = await this.querier.insertOne(Company, { name: 'JSON Many Paths', kind: { public: 1 } });
    const set = Object.fromEntries(parents.map((parent) => [`${parent}.leaf`, 1]));

    await this.querier.updateOneById(Company, id, { kind: { $set: set } });

    const expected = Object.fromEntries(parents.map((parent) => [parent, { leaf: 1 }]));
    expect(await this.kindOf(id)).toEqual({ public: 1, ...expected });
  }

  /** A dotted `$set` and `$unset` of siblings keep the rest of their parent. */
  async shouldSetAndUnsetSiblingJsonPaths() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Sibling Paths',
      kind: { public: 1, meta: { plan: 'free', coupon: 'X', seats: 2 } },
    });

    await this.querier.updateOneById(Company, id, { kind: { $set: { 'meta.plan': 'pro' }, $unset: ['meta.coupon'] } });

    expect(await this.kindOf(id)).toEqual({ public: 1, meta: { plan: 'pro', seats: 2 } });
  }

  /** A `$set` beside a nested object keeps every typed value under it, whatever its engine stores JSON as. */
  async shouldKeepNestedJsonTypesWhenSettingOneLeaf() {
    const id = await this.querier.insertOne(LooseDoc, {
      name: 'JSON Nested Types',
      doc: { public: 1, theme: { color: 'red', nested: { n: 1.5, list: [true, null, 'x'] } } },
    });

    await this.querier.updateOneById(LooseDoc, id, { doc: { $set: { 'theme.color': 'blue' } } });

    const found = await this.querier.findOneById(LooseDoc, id, { $select: { doc: true } });
    expect(found?.doc).toEqual({
      public: 1,
      theme: { color: 'blue', nested: { n: 1.5, list: [true, null, 'x'] } },
    });
  }

  /** `$inc` adds to what is stored, a NULL counting as 0, on every engine. */
  async shouldIncrementANumericField() {
    const id = await this.querier.insertOne(Item, { name: 'Counted', salePrice: null });

    await this.querier.updateOneById(Item, id, { salePrice: { $inc: 5 } });
    await this.querier.updateOneById(Item, id, { salePrice: { $inc: -2 } });

    const found = await this.querier.findOneById(Item, id, { $select: { salePrice: true } });
    expect(found?.salePrice).toBe(3);
  }

  /** `$mul` scales what is stored, a NULL counting as 0, on every engine. */
  async shouldMultiplyANumericField() {
    const [unset, priced] = await this.querier.insertMany(Item, [
      { name: 'Unpriced', salePrice: null },
      { name: 'Priced', salePrice: 4 },
    ]);

    await this.querier.updateMany(Item, { $where: { id: [unset, priced] } }, { salePrice: { $mul: 3 } });

    const found = await this.querier.findMany(Item, {
      $select: { salePrice: true },
      $where: { id: [unset, priced] },
      $sort: { name: 'desc' },
    });
    expect(found.map((item) => item.salePrice)).toEqual([0, 12]);
  }

  /** A decrement guarded by the same row's value, so two writers racing for the last unit cannot both take it. */
  async shouldDecrementOnlyWhereTheGuardHolds() {
    const id = await this.querier.insertOne(Item, { name: 'Last unit', salePrice: 1 });
    const take = () =>
      this.querier.updateMany(Item, { $where: { id, salePrice: { $gte: 1 } } }, { salePrice: { $inc: -1 } });

    expect(await take()).toBe(1);
    expect(await take()).toBe(0);

    const found = await this.querier.findOneById(Item, id, { $select: { salePrice: true } });
    expect(found?.salePrice).toBe(0);
  }

  /** A JSONB `$set` persists `true` and `false`, not only numbers and strings. */
  async shouldSetJsonBooleanField() {
    const id = await this.querier.insertOne(Company, {
      name: 'Bool JSON merge',
      kind: { description: 'x' },
    });

    await this.querier.updateOneById(Company, id, {
      kind: { $set: { isArchived: true } },
    });
    let found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ description: 'x', isArchived: true });

    await this.querier.updateOneById(Company, id, {
      kind: { $set: { isArchived: false } },
    });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ description: 'x', isArchived: false });
  }

  /** An upsert matching on another field writes the payload's key only on a row it inserts: a found row keeps its own. */
  async shouldKeepTheKeyOfARowAnUpsertFindsByAnotherField() {
    const id = await this.querier.insertOne(Carrier, { code: 'kept', name: 'first' });

    await this.querier.upsertOne(
      Carrier,
      { $conflict: { code: true } },
      { id: 'another', code: 'kept', name: 'second' },
    );

    expect(
      await this.querier.findMany(Carrier, { $select: { id: true, name: true }, $where: { code: 'kept' } }),
    ).toEqual([{ id, name: 'second' }]);
  }

  /** The first upsert inserts the row and the second updates it, each resolving to the row's id. */
  async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';

    const inserted = await this.querier.upsertOne(
      TaxCategory,
      { $conflict: { pk: true } },
      { pk, name: 'Some Name C' },
    );
    expect(await this.taxCategoryNames(pk)).toEqual(['Some Name C']);
    const updated = await this.querier.upsertOne(TaxCategory, { $conflict: { pk: true } }, { pk, name: 'Some Name D' });

    expect([inserted, updated]).toEqual([pk, pk]);
    expect(await this.taxCategoryNames(pk)).toEqual(['Some Name D']);
  }

  /** The row inserts as written; on a conflict, only `update` applies, so a counter can count. */
  async shouldUpsertWithAnUpdateOfItsOwn() {
    const id = '507f1f77bcf86cd799439012';
    const row = { id, name: 'VAT', percentage: 10 };
    const update = { percentage: { $inc: 5 } } as const;
    await this.querier.upsertOne(Tax, { $conflict: { id: true }, $update: update }, row);
    expect(await this.querier.findOneById(Tax, id, { $select: { name: true, percentage: true } })).toEqual({
      name: 'VAT',
      percentage: 10,
    });
    await this.querier.upsertOne(Tax, { $conflict: { id: true }, $update: update }, { ...row, name: 'renamed' });
    await this.querier.upsertMany(Tax, { $conflict: { id: true }, $update: update }, [row]);
    expect(await this.querier.findOneById(Tax, id, { $select: { name: true, percentage: true } })).toEqual({
      name: 'VAT',
      percentage: 20,
    });
  }

  /** An empty `update` leaves a conflicting row as it is, `onUpdate` fills included: insert only if absent. */
  async shouldUpsertWithAnEmptyUpdateLeavingTheRowAsItIs() {
    const id = '507f1f77bcf86cd799439013';
    await this.querier.upsertOne(Tax, { $conflict: { id: true }, $update: {} }, { id, name: 'VAT' });
    const ignored = await this.querier.upsertOne(
      Tax,
      { $conflict: { id: true }, $update: {} },
      { id, name: 'renamed' },
    );
    const batch = await this.querier.upsertMany(Tax, { $conflict: { id: true }, $update: {} }, [
      { id, name: 'renamed' },
    ]);
    expect([ignored, batch]).toEqual([id, [id]]);
    const stored = await this.querier.findOneById(Tax, id, { $select: { name: true, updatedAt: true } });
    assertDefined(stored);
    expect([stored.name, stored.updatedAt == null]).toEqual(['VAT', true]);
  }

  /** A found row matching `$where` takes the update, one that does not stays as it is, and the rest insert. */
  async shouldUpsertOnlyTheFoundRowsItsWhereMatches() {
    const [low, high, absent] = ['507f1f77bcf86cd799439014', '507f1f77bcf86cd799439015', '507f1f77bcf86cd799439016'];
    await this.querier.insertMany(Tax, [
      { id: low, name: 'low', percentage: 10 },
      { id: high, name: 'high', percentage: 50 },
    ]);
    const ids = await this.querier.upsertMany(
      Tax,
      { $conflict: { id: true }, $where: { percentage: { $lt: 20 } } },
      [low, high, absent].map((id) => ({ id, name: 'renamed', percentage: 1 })),
    );
    expect(ids).toEqual([low, high, absent]);
    expect(await this.taxesById([low, high, absent])).toEqual([
      { id: low, name: 'renamed', percentage: 1 },
      { id: high, name: 'high', percentage: 50 },
      { id: absent, name: 'renamed', percentage: 1 },
    ]);
  }

  /** `$where` guards an `update` of its own too, `onUpdate` fills included, so a row it skips is not touched at all. */
  async shouldUpsertWithAnUpdateOnlyWhereTheFoundRowMatches() {
    const [open, closed] = ['507f1f77bcf86cd799439017', '507f1f77bcf86cd799439018'];
    await this.querier.insertMany(Tax, [
      { id: open, name: 'open', percentage: 10 },
      { id: closed, name: 'closed', percentage: 10 },
    ]);
    await this.querier.upsertMany(
      Tax,
      { $conflict: { id: true }, $where: { name: 'open' }, $update: { percentage: { $inc: 5 } } },
      [open, closed].map((id) => ({ id, name: 'x' })),
    );
    const stored = await this.querier.findMany(Tax, {
      $select: { id: true, percentage: true, updatedAt: true },
      $where: { id: [open, closed] },
      $sort: { name: 1 },
    });
    expect(stored.map((it) => [it.id, it.percentage, it.updatedAt == null])).toEqual([
      [closed, 10, true],
      [open, 15, false],
    ]);
  }

  /** `returning` reports every row as it stands after the upsert: written, inserted, or kept by its `$where`. */
  async shouldUpsertReturningEachRowAsItStands() {
    const [counted, kept, absent] = [
      '507f1f77bcf86cd799439019',
      '507f1f77bcf86cd79943901a',
      '507f1f77bcf86cd79943901b',
    ];
    await this.querier.insertMany(Tax, [
      { id: counted, name: 'counted', percentage: 10 },
      { id: kept, name: 'kept', percentage: 10 },
    ]);

    const rows = await this.querier.upsertMany(
      Tax,
      { $conflict: { id: true }, $where: { name: { $ne: 'kept' } }, $update: { percentage: { $inc: 5 } } },
      [counted, kept, absent].map((id) => ({ id, name: 'counted', percentage: 1 })),
      { returning: { id: true, name: true, percentage: true } },
    );

    expect(rows).toEqual([
      { id: counted, name: 'counted', percentage: 15 },
      { id: kept, name: 'kept', percentage: 10 },
      { id: absent, name: 'counted', percentage: 1 },
    ]);
  }

  /** An empty `update` writes no found row, so `returning` reads it as it is: get or create, in one call. */
  async shouldUpsertReturningAFoundRowAnEmptyUpdateKeeps() {
    const id = '507f1f77bcf86cd79943901c';
    await this.querier.insertOne(Tax, { id, name: 'existing', percentage: 3 });

    const row = await this.querier.upsertOne(
      Tax,
      { $conflict: { id: true }, $update: {} },
      { id, name: 'new', percentage: 9 },
      { returning: { id: true, name: true } },
    );

    expect(row).toEqual({ id, name: 'existing' });
  }

  private async taxesById(ids: readonly string[]) {
    const rows = await this.querier.findMany(Tax, {
      $select: { id: true, name: true, percentage: true },
      $where: { id: [...ids] },
    });
    return ids.map((id) => rows.find((row) => row.id === id));
  }

  private async adjustmentPrices(inventoryAdjustmentId: InventoryAdjustment['id']) {
    const rows = await this.querier.findMany(ItemAdjustment, {
      $select: { buyPrice: true },
      $where: { inventoryAdjustmentId },
      $sort: { buyPrice: 1 },
    });
    return rows.map((it) => it.buyPrice);
  }

  /** An upsert writes a row's relations on either branch, as an insert or an update does: a found row's are replaced. */
  async shouldUpsertAndCascadeOneToManyOnEitherBranch() {
    const id = '507f1f77bcf86cd799439041';
    await this.querier.upsertOne(
      InventoryAdjustment,
      { $conflict: { id: true } },
      { id, itemAdjustments: [{ buyPrice: 5 }] },
    );
    expect(await this.adjustmentPrices(id)).toEqual([5]);
    await this.querier.upsertMany(InventoryAdjustment, { $conflict: { id: true } }, [
      { id, description: 'found', itemAdjustments: [{ buyPrice: 7 }, { buyPrice: 9 }] },
    ]);
    expect(await this.adjustmentPrices(id)).toEqual([7, 9]);
    await this.querier.saveOne(InventoryAdjustment, { id, itemAdjustments: [{ buyPrice: 4 }] });
    expect(await this.adjustmentPrices(id)).toEqual([4]);
  }

  /** A found row takes the relations its `update` names, and an inserted one the payload's. */
  async shouldUpsertWithAnUpdateCascadingOneToMany() {
    const found = '507f1f77bcf86cd799439042';
    const inserted = '507f1f77bcf86cd799439043';
    await this.querier.insertOne(InventoryAdjustment, {
      id: found,
      description: 'there',
      itemAdjustments: [{ buyPrice: 1 }],
    });
    await this.querier.upsertMany(
      InventoryAdjustment,
      { $conflict: { id: true }, $update: { itemAdjustments: [{ buyPrice: 2 }] } },
      [
        { id: found, description: 'payload', itemAdjustments: [{ buyPrice: 3 }] },
        { id: inserted, description: 'payload', itemAdjustments: [{ buyPrice: 3 }] },
      ],
    );
    expect([await this.adjustmentPrices(found), await this.adjustmentPrices(inserted)]).toEqual([[2], [3]]);
    const row = await this.querier.findOneById(InventoryAdjustment, found, { $select: { description: true } });
    assertDefined(row);
    expect(row.description).toBe('there');
  }

  /** A found row takes the relations its `update` names even when the payload names none. */
  async shouldUpsertWithAnUpdateCascadingWhatThePayloadDoesNot() {
    const id = '507f1f77bcf86cd799439044';
    await this.querier.insertOne(InventoryAdjustment, { id, itemAdjustments: [{ buyPrice: 1 }] });

    await this.querier.upsertOne(
      InventoryAdjustment,
      { $conflict: { id: true }, $update: { itemAdjustments: [{ buyPrice: 2 }] } },
      { id },
    );

    expect(await this.adjustmentPrices(id)).toEqual([2]);
  }

  /** A key two rows share names neither of them, so the upsert inserts rather than guess which to update. */
  async shouldUpsertAsNewWhenItsKeyMatchesTwoRows() {
    await this.querier.insertMany(InventoryAdjustment, [{ description: 'twin' }, { description: 'twin' }]);

    await this.querier.upsertOne(
      InventoryAdjustment,
      { $conflict: { description: true } },
      { description: 'twin', itemAdjustments: [{ buyPrice: 3 }] },
    );

    expect(await this.querier.count(InventoryAdjustment, { $where: { description: 'twin' } })).toBe(3);
  }

  async shouldUpsertManyEmpty() {
    expect(await this.querier.upsertMany(TaxCategory, { $conflict: { pk: true } }, [])).toEqual([]);
  }

  async shouldUpsertMany() {
    const pks = ['507f1f77bcf86cd799439021', '507f1f77bcf86cd799439022'];

    const inserted = await this.querier.upsertMany(TaxCategory, { $conflict: { pk: true } }, [
      { pk: pks[0], name: 'Upsert A' },
      { pk: pks[1], name: 'Upsert B' },
    ]);
    expect(await this.taxCategoryNames(...pks)).toEqual(['Upsert A', 'Upsert B']);
    const updated = await this.querier.upsertMany(TaxCategory, { $conflict: { pk: true } }, [
      { pk: pks[0], name: 'Updated A' },
      { pk: pks[1], name: 'Updated B' },
    ]);

    expect([inserted, updated]).toEqual([pks, pks]);
    expect(await this.taxCategoryNames(...pks)).toEqual(['Updated A', 'Updated B']);
  }

  /**
   * A batch whose rows carry different columns: the `SET` list comes from the whole batch, so a first row
   * carrying only the conflict column does not turn the statement into `DO NOTHING`.
   */
  async shouldUpsertManyWithHeterogeneousFieldSets() {
    const pk1 = '507f1f77bcf86cd799439031';
    const pk2 = '507f1f77bcf86cd799439032';

    await this.querier.upsertMany(TaxCategory, { $conflict: { pk: true } }, [
      { pk: pk1, name: 'Het A' },
      { pk: pk2, name: 'Het B' },
    ]);

    await this.querier.upsertMany(TaxCategory, { $conflict: { pk: true } }, [
      { pk: pk1 },
      { pk: pk2, name: 'Het B updated' },
    ]);

    expect(await this.taxCategoryNames(pk1, pk2)).toEqual(['Het A', 'Het B updated']);
  }

  /** `saveMany` reports its ids in payload order, as `insertMany` does, whatever mix of rows it was given. */
  async shouldSaveManyReportingIdsInPayloadOrder() {
    const [seeded] = await this.querier.insertMany(User, [{ name: 'Save Order Seed', createdAt: 1 }]);

    const ids = await this.querier.saveMany(User, [
      { id: seeded, name: 'Save Order Updated', updatedAt: 2 },
      { name: 'Save Order New', createdAt: 2 },
    ]);

    expect(ids).toEqual([seeded, anyUuid]);
    expect(await this.querier.findOneById(User, ids[0], { $select: { name: true } })).toEqual({
      name: 'Save Order Updated',
    });
    expect(await this.querier.findOneById(User, ids[1], { $select: { name: true } })).toEqual({
      name: 'Save Order New',
    });
  }

  async shouldFillTheTenantOfARowInsertedWithoutOne() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'mine' }));
    assertDefined(id);

    const row = await asSystem(() => this.querier.findOneById(TenantNote, id, { $select: { tenantId: true } }));

    expect(row).toEqual({ tenantId: 'a' });
  }

  async shouldInsertARowNamingItsOwnTenant() {
    await asTenant('a', () => this.querier.insertOne(TenantNote, { tenantId: 'a', title: 'mine' }));

    expect(await asTenant('a', () => this.querier.count(TenantNote))).toBe(1);
  }

  async shouldRefuseAnInsertIntoAnotherTenant() {
    const refused = await asTenant('a', () =>
      this.querier.insertOne(TenantNote, { tenantId: 'b', title: 'theirs' }),
    ).catch(thrownValue);

    expect(queryErrorKind(refused)).toBe('security');
    expect(await asSystem(() => this.querier.count(TenantNote))).toBe(0);
  }

  async shouldUpdateARowKeepingItsTenant() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));
    assertDefined(id);

    const changes = await asTenant('a', () =>
      this.querier.updateOneById(TenantNote, id, { tenantId: 'a', title: 'final' }),
    );

    expect(changes).toBe(1);
  }

  async shouldRefuseAnUpdateMovingARowToAnotherTenant() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'mine' }));
    assertDefined(id);

    const refused = await asTenant('a', () => this.querier.updateOneById(TenantNote, id, { tenantId: 'b' })).catch(
      thrownValue,
    );

    expect(queryErrorKind(refused)).toBe('security');
    expect(await asTenant('a', () => this.querier.count(TenantNote))).toBe(1);
  }

  async shouldSaveItsOwnRowByKeyAndInsertTheRest() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));

    await asTenant('a', () => this.querier.saveMany(TenantNote, [{ id, title: 'final' }, { title: 'new' }]));

    const rows = await asSystem(() =>
      this.querier.findMany(TenantNote, { $select: { tenantId: true, title: true }, $sort: { title: 'asc' } }),
    );
    expect(rows).toEqual([
      { tenantId: 'a', title: 'final' },
      { tenantId: 'a', title: 'new' },
    ]);
  }

  async shouldRefuseASaveTakingOverAnotherTenantsRow() {
    const id = await asTenant('b', () => this.querier.insertOne(TenantNote, { title: 'theirs' }));
    assertDefined(id);

    const refused = await asTenant('a', () => this.querier.saveOne(TenantNote, { id, title: 'mine now' })).catch(
      thrownValue,
    );

    expect(queryErrorKind(refused)).toBe('uniqueViolation');
    const row = await asSystem(() =>
      this.querier.findOneById(TenantNote, id, { $select: { tenantId: true, title: true } }),
    );
    expect(row).toEqual({ tenantId: 'b', title: 'theirs' });
  }

  async shouldUpsertItsOwnRowOnAConflict() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));
    assertDefined(id);

    const result = await asTenant('a', () =>
      this.querier.upsertOne(TenantNote, { $conflict: { id: true } }, { id, title: 'final' }),
    );

    expect(result).toBe(id);
    const row = await asSystem(() =>
      this.querier.findOneById(TenantNote, id, { $select: { tenantId: true, title: true } }),
    );
    expect(row).toEqual({ tenantId: 'a', title: 'final' });
  }

  /** A guarded upsert reads its row through the filter first, then gives it `update`, as the statement would. */
  async shouldUpsertAGuardedRowWithAnUpdateOfItsOwn() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));
    assertDefined(id);

    await asTenant('a', () =>
      this.querier.upsertOne(
        TenantNote,
        { $conflict: { id: true }, $update: { title: 'update' } },
        { id, title: 'payload' },
      ),
    );

    const row = await asSystem(() => this.querier.findOneById(TenantNote, id, { $select: { title: true } }));
    expect(row).toEqual({ title: 'update' });
  }

  /** The read-then-write path a guarded entity takes reads `$where` as the statement does. */
  async shouldUpsertAGuardedRowOnlyWhereItMatches() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));
    assertDefined(id);

    for (const title of ['published', 'draft']) {
      await asTenant('a', () =>
        this.querier.upsertOne(
          TenantNote,
          { $conflict: { id: true }, $where: { title } },
          { id, title: `was ${title}` },
        ),
      );
    }

    const row = await asSystem(() => this.querier.findOneById(TenantNote, id, { $select: { title: true } }));
    expect(row).toEqual({ title: 'was draft' });
  }

  async shouldUpsertAGuardedRowWithAnEmptyUpdateLeavingItAsItIs() {
    const id = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));
    assertDefined(id);

    const result = await asTenant('a', () =>
      this.querier.upsertOne(TenantNote, { $conflict: { id: true }, $update: {} }, { id, title: 'payload' }),
    );

    expect(result).toBe(id);
    const row = await asSystem(() => this.querier.findOneById(TenantNote, id, { $select: { title: true } }));
    expect(row).toEqual({ title: 'draft' });
  }

  async shouldRollBackAGuardedUpsertBatchReachingAnotherTenantsRow() {
    const mine = await asTenant('a', () => this.querier.insertOne(TenantNote, { title: 'draft' }));
    const theirs = await asTenant('b', () => this.querier.insertOne(TenantNote, { title: 'theirs' }));

    const refused = await asTenant('a', () =>
      this.querier.transaction(() =>
        this.querier.upsertMany(TenantNote, { $conflict: { id: true } }, [
          { id: mine, title: 'final' },
          { id: theirs, title: 'mine now' },
        ]),
      ),
    ).catch(thrownValue);

    expect(queryErrorKind(refused)).toBe('uniqueViolation');
    const rows = await asSystem(() =>
      this.querier.findMany(TenantNote, { $select: { tenantId: true, title: true }, $sort: { tenantId: 'asc' } }),
    );
    expect(rows).toEqual([
      { tenantId: 'a', title: 'draft' },
      { tenantId: 'b', title: 'theirs' },
    ]);
  }

  async shouldUpsertNoRowsOfAGuardedEntity() {
    expect(await asTenant('a', () => this.querier.upsertMany(TenantNote, { $conflict: { id: true } }, []))).toEqual([]);
  }

  async shouldWriteAnyTenantUnderASystemContext() {
    const id = await asSystem(() => this.querier.insertOne(TenantNote, { tenantId: 'b', title: 'seeded' }));
    assertDefined(id);

    expect(await asSystem(() => this.querier.updateOneById(TenantNote, id, { tenantId: 'c' }))).toBe(1);
    expect(await asTenant('c', () => this.querier.count(TenantNote))).toBe(1);
  }

  async shouldFindOne() {
    await this.querier.insertMany(User, [
      { name: 'a', email: 'a@example.com', password: '123456789a!' },
      { name: 'b', email: 'b@example.com', password: '123456789b!' },
    ]);

    const found = await this.querier.findOne(User, {
      $select: { name: true, email: true, password: true },
      $where: { email: 'a@example.com' },
    });

    expect(found).toEqual({ name: 'a', email: 'a@example.com', password: '123456789a!' });
    expect(await this.querier.findOne(User, { $where: { name: 'nobody' } })).toBeUndefined();
  }

  /**
   * `$not` negates the AND of its clauses and `$nor` the OR: alone, together, beside a field, nested in a
   * group, over an operator map, and over a relation, whose join (MongoDB's `$lookup` too) still has to be
   * there. With nothing to negate, either constrains nothing, as an empty `$and` does.
   */
  async shouldFindByRootNegationOperators() {
    const companyId = await this.querier.insertOne(Company, { name: 'Acme' });
    await this.querier.insertMany(User, [
      { name: 'a', email: 'a@example.com' },
      { name: 'b', email: 'b@example.com' },
      { name: 'c', email: 'c@example.com' },
      { name: 'd', email: 'd@example.com', companyId },
    ]);
    const names = async ($where: QueryWhere<User>) =>
      (await this.querier.findMany(User, { $select: { name: true }, $sort: { name: 1 }, $where })).map(
        ({ name }) => name,
      );

    expect(await names({ $not: [{ name: 'a' }, { email: 'a@example.com' }] })).toEqual(['b', 'c', 'd']);
    expect(await names({ $nor: [{ name: 'a' }, { email: 'b@example.com' }] })).toEqual(['c', 'd']);
    expect(await names({ $not: [{ name: 'a' }] })).toEqual(['b', 'c', 'd']);
    expect(await names({ $not: [{ name: 'a' }], $nor: [{ name: 'b' }] })).toEqual(['c', 'd']);
    expect(await names({ email: 'c@example.com', $nor: [{ name: 'a' }] })).toEqual(['c']);
    expect(await names({ $or: [{ $not: [{ name: 'a' }] }, { name: 'a' }] })).toEqual(['a', 'b', 'c', 'd']);
    expect(await names({ $nor: [{ name: { $in: ['a', 'b'] } }] })).toEqual(['c', 'd']);
    expect(await names({ $nor: [{ company: { name: 'Acme' } }] })).toEqual(['a', 'b', 'c']);
    expect(await names({ $not: [{ company: { name: 'Acme' } }] })).toEqual(['a', 'b', 'c']);
    expect(await names({ $nor: [] })).toEqual(['a', 'b', 'c', 'd']);
    expect(await names({ $and: [] })).toEqual(['a', 'b', 'c', 'd']);
  }

  async shouldCount() {
    const companyId = await this.querier.insertOne(Company, { name: 'Acme' });
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }, { name: 'c', companyId }]);

    await expect(this.querier.count(User, {})).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: null } })).resolves.toBe(2);
    await expect(this.querier.count(User, { $where: { companyId } })).resolves.toBe(1);
  }

  /** No value is in the empty set, so `$in: []` matches no row and `$nin: []` every one, a null included. */
  async shouldMatchAnEmptySet() {
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }, { email: 'nameless' }]);

    await expect(this.querier.count(User, { $where: { name: { $in: [] } } })).resolves.toBe(0);
    await expect(this.querier.count(User, { $where: { name: { $nin: [] } } })).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { name: { $not: { $in: [] } } } })).resolves.toBe(3);
  }

  /** `max(0, total - $skip)`, capped at `$limit`. */
  async shouldCountAPage() {
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }]);

    await expect(this.querier.count(User, { $limit: 1 })).resolves.toBe(1);
    await expect(this.querier.count(User, { $limit: 10 })).resolves.toBe(2);

    await expect(this.querier.count(User, { $skip: 1 })).resolves.toBe(1);
    await expect(this.querier.count(User, { $skip: 5 })).resolves.toBe(0);
    await expect(this.querier.count(User, { $skip: 1, $limit: 5 })).resolves.toBe(1);
  }

  /** A capped count, in either call form: true the moment one row matches, false when none does, an empty table included. */
  async shouldTellWhetherARowExists() {
    await expect(this.querier.exists(User)).resolves.toBe(false);
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }]);

    await expect(this.querier.exists(User)).resolves.toBe(true);
    await expect(this.querier.exists(User, { $where: { name: 'b' } })).resolves.toBe(true);
    await expect(this.querier.exists(User, { $where: { name: 'nobody' } })).resolves.toBe(false);
    await expect(this.querier.exists({ $entity: User, $where: { name: 'b' } })).resolves.toBe(true);
    await expect(this.querier.exists({ $entity: User, $where: { name: 'nobody' } })).resolves.toBe(false);
  }

  /**
   * `count` takes no `$sort`, but `/http` passes a query on unchecked, so one can arrive, on any backend.
   * The SQL it emits is pinned in `shouldCountDroppingASmuggledSort`.
   */
  async shouldCountIgnoringASmuggledSort() {
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }]);

    const sorted: QuerySearch<User> = { $sort: { name: -1 }, $skip: 1, $limit: 1 };

    await expect(this.querier.count(User, sorted)).resolves.toBe(1);
    // @ts-expect-error: a count takes no `$sort`
    await expect(this.querier.count(User, { $sort: { name: 1 } })).resolves.toBe(2);
  }

  /** `$limit: 0` asks for no rows on every backend, where MongoDB's own `limit(0)` means *unlimited*. */
  async shouldReadNoRowsOnAZeroLimit() {
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }]);

    await expect(this.querier.findMany(User, { $limit: 0 })).resolves.toEqual([]);
    await expect(this.querier.count(User, { $limit: 0 })).resolves.toBe(0);
  }

  async shouldUpdateMany() {
    await this.querier.insertMany(User, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    const companyId = await this.querier.insertOne(Company, { name: 'Acme' });

    await expect(this.querier.updateMany(User, { $where: { companyId } }, { companyId: null })).resolves.toBe(0);
    await expect(this.querier.updateMany(User, { $where: { companyId: null } }, { companyId })).resolves.toBe(3);
    await expect(this.querier.updateMany(User, { $where: { companyId } }, { companyId: null })).resolves.toBe(3);
  }

  async shouldRefuseAnUnknownComparisonOperator() {
    await expect(
      this.querier.findMany(User, {
        // @ts-expect-error: no such operator
        $where: { name: { $someInvalidOperator: 'some' } },
      }),
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  /** What a transaction writes it sees, and a commit keeps, at the default isolation level or one asked for. */
  async shouldCommit() {
    await this.querier.transaction(async () => {
      await this.querier.insertOne(User, {});
      await expect(this.querier.count(User, {})).resolves.toBe(1);
    });
    await this.querier.transaction(() => this.querier.insertOne(User, {}), { isolationLevel: 'serializable' });

    await expect(this.querier.count(User, {})).resolves.toBe(2);
  }

  /** A read-only transaction reads as any other, whatever the engine spells the mode as, at a level asked for too. */
  async shouldReadInAReadOnlyTransaction() {
    await this.querier.insertOne(User, {});

    const counted = await this.querier.transaction(() => this.querier.count(User, {}), {
      readOnly: true,
      isolationLevel: 'serializable',
    });

    expect(counted).toBe(1);
  }

  /** What a transaction writes it sees, and a rollback drops, at the default isolation level or one asked for. */
  async shouldRollBackAManualTransaction() {
    await this.querier.beginTransaction();
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.rollbackTransaction();
    await this.querier.beginTransaction({ isolationLevel: 'read committed' });
    await this.querier.insertOne(User, {});
    await this.querier.rollbackTransaction();

    await expect(this.querier.count(User, {})).resolves.toBe(0);
  }

  async shouldIgnoreRollbackTransactionWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).resolves.toBeUndefined();
    expect(this.querier.hasOpenTransaction).toBe(false);
  }

  async shouldRefuseABeginInsideATransaction() {
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    expect(queryErrorKind(await this.querier.beginTransaction().catch(thrownValue))).toBe('usage');
  }

  async shouldRefuseACommitWithoutATransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
    expect(queryErrorKind(await this.querier.commitTransaction().catch(thrownValue))).toBe('usage');
  }

  async shouldRollback() {
    await expect(
      this.querier.transaction(async () => {
        await this.querier.insertOne(User, {});
        await expect(this.querier.count(User, {})).resolves.toBe(1);
        throw new TypeError('roll back');
      }),
    ).rejects.toThrow('roll back');
    await expect(
      this.querier.transaction(
        async () => {
          await this.querier.insertOne(User, {});
          throw new TypeError('roll back');
        },
        { isolationLevel: 'read committed' },
      ),
    ).rejects.toThrow('roll back');

    await expect(this.querier.count(User, {})).resolves.toBe(0);
  }

  /** The callback's value comes back once its writes commit. */
  async shouldRunATransactionCallbackAtAnIsolationLevel() {
    const result = await this.querier.transaction(
      async () => {
        await this.querier.insertOne(User, { name: 'isolated' });
        return this.querier.count(User, {});
      },
      { isolationLevel: 'serializable' },
    );
    expect(result).toBe(1);
    await expect(this.querier.count(User, {})).resolves.toBe(1);
  }

  /** A nested transaction joins the outer one, so its throw rolls back both. */
  async shouldRollbackEntireTransactionWhenNestedThrows() {
    await expect(
      this.querier.transaction(async () => {
        await this.querier.insertOne(User, { name: 'outer' });
        await this.querier.transaction(async () => {
          await this.querier.insertOne(User, { name: 'inner' });
          throw new TypeError('inner error');
        });
      }),
    ).rejects.toThrow(this.nestedTransactionError());

    await expect(this.querier.count(User, {})).resolves.toBe(0);
  }

  async shouldPopulateOverNoRows() {
    expect(
      await this.querier.findOneById(InventoryAdjustment, '-1', {
        $populate: { itemAdjustments: true, creator: true },
      }),
    ).toBeUndefined();
    expect(await this.querier.findMany(InventoryAdjustment, { $populate: { itemAdjustments: true } })).toEqual([]);
  }

  async shouldPopulateAToManyAndAToOne() {
    const creatorId = await this.querier.insertOne(User, { name: 'creator', email: 'creator@example.com' });
    const [firstItemId, secondItemId] = await this.querier.insertMany(Item, [
      { name: 'some item name a', creatorId },
      { name: 'some item name b', creatorId },
    ]);
    const id = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some inventory adjustment',
      creatorId,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
    });

    const found = await this.querier.findOneById(InventoryAdjustment, id, {
      $populate: { itemAdjustments: { $sort: { buyPrice: 1 } }, creator: true },
    });

    expect(found).toMatchObject({
      id,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
      creator: { name: 'creator', email: 'creator@example.com' },
    });
  }

  async shouldDeleteMany() {
    const companyId = await this.querier.insertOne(Company, { name: 'Acme' });
    await this.querier.insertMany(User, [{ name: 'a', companyId }, { name: 'b' }, { name: 'c' }, { name: 'd' }]);

    await expect(this.querier.deleteMany(User, { $where: { companyId } })).resolves.toBe(1);
    await expect(this.querier.deleteMany(User, { $where: { companyId: null } })).resolves.toBe(3);
    await expect(this.querier.count(User, {})).resolves.toBe(0);
  }

  /**
   * A bulk write names the rows it changes: an empty `$where`, a key left `undefined` (the WHERE drops it)
   * or a group none of whose clauses names one addresses every row, which is asked for by name instead.
   * The caller's mistake, so a `usage` error, a 400 over a transport, before any statement runs.
   */
  async shouldRefuseABulkWriteThatNamesNoRows() {
    await this.querier.insertMany(User, [{ name: 'one' }, { name: 'two' }]);

    await expect(this.querier.deleteMany(User, {})).rejects.toThrow("'deleteMany' over 'User' names no rows");
    await expect(this.querier.updateMany(User, {}, { name: 'x' })).rejects.toThrow(
      "'updateMany' over 'User' names no rows",
    );
    await expect(this.querier.deleteMany(User, { $where: {} })).rejects.toThrow('names no rows');
    await expect(this.querier.deleteMany(User, { $where: { id: undefined } })).rejects.toThrow('holds undefined');
    await expect(this.querier.updateMany(User, { $where: { id: undefined } }, { name: 'x' })).rejects.toThrow(
      'holds undefined',
    );
    await expect(this.querier.deleteMany(User, { $where: { $or: [{ id: undefined }] } })).rejects.toThrow(
      'holds undefined',
    );
    await expect(this.querier.deleteMany(User, { $where: { $and: [] } })).rejects.toThrow('names no rows');
    expect(queryErrorKind(await this.querier.deleteMany(User, {}).catch(thrownValue))).toBe('usage');
    await expect(this.querier.count(User)).resolves.toBe(2);
  }

  /** A to-one holding the key is written first, so the parent inserts already pointing at it. */
  async shouldWriteAToOneTargetBeforeTheRowHoldingItsKey() {
    const otherId = await this.querier.insertOne(Carrier, { code: 'other', name: 'Other' });
    const id = await this.querier.insertOne(Shipment, {
      name: 's1',
      carrier: { code: 'fast', name: 'Fast' },
      waybill: { number: 'W1' },
    });

    const shipment = await this.querier.findOneById(Shipment, id!, { $populate: { carrier: true, waybill: true } });
    expect(shipment?.carrier).toMatchObject({ code: 'fast', name: 'Fast' });
    expect(shipment?.waybill).toMatchObject({ number: 'W1' });
    expect(await this.querier.findOneById(Carrier, otherId!)).toMatchObject({ code: 'other', name: 'Other' });
  }

  /** A to-one naming only its key is a link: the target is neither written nor inserted again. */
  async shouldLinkAToOneReferenceWithoutWritingIt() {
    const carrierId = await this.querier.insertOne(Carrier, { code: 'fast', name: 'Fast' });
    const id = await this.querier.insertOne(Shipment, { name: 's1', carrier: { id: carrierId } });
    expect((await this.querier.findOneById(Shipment, id!))?.carrierId).toBe(carrierId);
    expect(await this.querier.count(Carrier)).toBe(1);

    await this.querier.updateOneById(Shipment, id!, { carrier: { code: 'slow', name: 'Slow' } });

    const shipment = await this.querier.findOneById(Shipment, id!, { $populate: { carrier: true } });
    expect(shipment?.carrier).toMatchObject({ code: 'slow', name: 'Slow' });
    expect(await this.querier.findOneById(Carrier, carrierId!)).toMatchObject({ code: 'fast', name: 'Fast' });
  }

  /** An update replaces a to-many: the children it lists keep what it does not write, and the rest go. */
  async shouldUpdateAToManyKeepingTheChildrenItStillLists() {
    const id = await this.querier.insertOne(Shipment, {
      name: 's1',
      parcels: [
        { content: 'a', weight: 1 },
        { content: 'b', weight: 2 },
      ],
    });
    const [kept] = await this.querier.findMany(Parcel, { $where: { content: 'a' } });

    await this.querier.updateOneById(Shipment, id!, {
      parcels: [
        { id: kept.id, weight: 10 },
        { content: 'c', weight: 3 },
      ],
    });

    const parcels = await this.querier.findMany(Parcel, {
      $select: { id: true, content: true, weight: true, createdAt: true },
      $sort: { content: 'asc' },
    });
    expect(parcels).toEqual([
      { id: kept.id, content: 'a', weight: 10, createdAt: kept.createdAt },
      { id: expect.any(String), content: 'c', weight: 3, createdAt: expect.any(Number) },
    ]);
  }

  /** An update replaces a many-to-many link by link: one it still lists is not written again. */
  async shouldUpdateAManyToManyTouchingOnlyTheLinksThatChanged() {
    const [first, second, third] = await this.querier.insertMany(Label, [
      { name: 'l1' },
      { name: 'l2' },
      { name: 'l3' },
    ]);
    const id = await this.querier.insertOne(Shipment, { name: 's1', labels: [{ id: first }, { id: second }] });
    const [kept] = await this.querier.findMany(ShipmentLabel, { $where: { labelId: second } });

    await this.querier.updateOneById(Shipment, id!, { labels: [{ id: second }, { id: third }] });

    const links = await this.querier.findMany(ShipmentLabel, {
      $select: { id: true, labelId: true },
      $sort: { labelId: 'asc' },
    });
    expect(links).toEqual([
      { id: kept.id, labelId: second },
      { id: expect.any(String), labelId: third },
    ]);
  }

  /** A soft delete stamps what can be stamped and keeps the rest, so a restore brings the whole back. */
  async shouldKeepWhatASoftDeleteCannotStamp() {
    const [labelId] = await this.querier.insertMany(Label, [{ name: 'l1' }]);
    const id = await this.querier.insertOne(Shipment, {
      name: 's1',
      parcels: [{ content: 'a' }],
      labels: [{ id: labelId }],
    });

    await this.querier.deleteOneById(Shipment, id!);
    expect(await this.querier.count(Parcel)).toBe(1);
    expect(await this.querier.count(ShipmentLabel)).toBe(1);

    await this.querier.restoreOneById(Shipment, id!);
    const restored = await this.querier.findOneById(Shipment, id!, { $populate: { parcels: true, labels: true } });
    expect(restored?.parcels).toHaveLength(1);
    expect(restored?.labels).toHaveLength(1);

    await this.querier.deleteOneById(Shipment, id!, { hardDelete: true });
    expect(await this.querier.count(Parcel)).toBe(0);
    expect(await this.querier.count(ShipmentLabel)).toBe(0);
  }

  /** A write that cascades lands whole or not at all within the transaction the caller opens. */
  async shouldRollBackAWriteWhoseCascadeFails() {
    await expect(
      this.querier.transaction(() => this.querier.insertOne(Shipment, { name: 'lost', labels: [{ name: 'boom' }] })),
    ).rejects.toThrow('boom');
    expect(await this.querier.count(Shipment)).toBe(0);

    const id = await this.querier.insertOne(Shipment, { name: 'kept' });
    await expect(
      this.querier.transaction(() =>
        this.querier.updateOneById(Shipment, id!, { name: 'changed', labels: [{ name: 'boom' }] }),
      ),
    ).rejects.toThrow('boom');
    expect((await this.querier.findOneById(Shipment, id!))?.name).toBe('kept');
  }

  /** The names of every `Label`, sorted, read through the filters as any caller reads them. */
  private async labelNames(): Promise<(string | null | undefined)[]> {
    const labels = await this.pool.findMany(Label, { $select: { name: true }, $sort: { name: 'asc' } });
    return labels.map((label) => label.name);
  }

  /** Two transactions on one querier take turns: neither commits, nor rolls back, the other's work. */
  async shouldRunConcurrentTransactionsOnOneQuerierInTurn() {
    const failing = this.querier.transaction(async () => {
      await this.querier.insertOne(Label, { name: 'undone' });
      throw new Error('undo');
    });
    const passing = this.querier.transaction(async () => {
      await this.querier.insertOne(Label, { name: 'kept' });
    });

    await expect(failing).rejects.toThrow('undo');
    await passing;
    expect(await this.labelNames()).toEqual(['kept']);
  }

  /** Why a failing nested transaction rejects: its own error, or the engine having no savepoint to run it in. */
  protected nestedTransactionError(): string {
    return 'inner';
  }

  /** A savepoint undoes the nested writes alone; with none (MongoDB), the nested transaction is refused before it runs. */
  async shouldUndoAFailedNestedTransactionAlone() {
    await this.querier.transaction(async () => {
      await this.querier.insertOne(Label, { name: 'outer' });
      await expect(
        this.querier.transaction(async () => {
          await this.querier.insertOne(Label, { name: 'inner' });
          throw new Error('inner');
        }),
      ).rejects.toThrow(this.nestedTransactionError());
      await this.querier.insertOne(Label, { name: 'after' });
    });

    expect(await this.labelNames()).toEqual(['after', 'outer']);
  }

  /** A pool call inside the pool's transaction runs in it, so it rolls back with it. */
  async shouldRunAPoolCallInsideThePoolsTransaction() {
    const failed = await this.pool
      .transaction(async () => {
        await this.pool.insertOne(Label, { name: 'joined' });
        expect(await this.pool.count(Label)).toBe(1);
        throw new Error('undo');
      })
      .catch(thrownValue);

    expect(failed).toBeInstanceOf(Error);
    expect(await this.labelNames()).toEqual([]);
  }

  /** A write from another flow waits for a transaction rather than landing in it, so its rollback keeps it. */
  async shouldKeepAnotherFlowsWriteOutOfATransaction() {
    let enter!: () => void;
    let leave!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const left = new Promise<void>((resolve) => {
      leave = resolve;
    });
    const transaction = this.pool
      .transaction(async () => {
        await this.pool.insertOne(Label, { name: 'undone' });
        enter();
        await left;
        throw new Error('undo');
      })
      .catch(thrownValue);

    await entered;
    const outside = this.pool.insertOne(Label, { name: 'kept' });
    leave();
    await Promise.all([transaction, outside]);

    expect(await this.labelNames()).toEqual(['kept']);
  }

  /** `onCommit` waits for the commit, is dropped by a rollback, and runs at once outside a transaction. */
  async shouldRunOnCommitOnlyOnceCommitted() {
    const ran: string[] = [];
    await this.querier.transaction(async () => {
      await this.querier.onCommit(() => ran.push('committed'));
      expect(ran).toEqual([]);
    });
    await this.querier
      .transaction(async () => {
        await this.querier.onCommit(() => ran.push('rolled back'));
        throw new Error('undo');
      })
      .catch(thrownValue);
    await this.querier.onCommit(() => ran.push('at once'));

    expect(ran).toEqual(['committed', 'at once']);
  }

  /** `returning` reads back what each write wrote, the fields the database or an `onInsert` filled included. */
  async shouldReturnTheRowsAnInsertWrote() {
    const inserted = await this.querier.insertOne(Label, { name: 'one' }, { returning: { id: true, createdAt: true } });
    expect(inserted).toEqual({ id: expect.any(String), createdAt: expect.any(Number) });

    const many = await this.querier.insertMany(Label, [{ name: 'two' }, { name: 'three' }], {
      returning: { name: true },
    });
    expect(many).toEqual([{ name: 'two' }, { name: 'three' }]);
  }

  /** An upsert takes its entity as the query's `$entity`, as a read does. */
  async shouldUpsertTheEntityItsQueryNames() {
    const created = await this.querier.upsertOne(
      { $entity: Label, $conflict: { name: true } },
      { name: 'named' },
      {
        returning: { name: true },
      },
    );
    expect(created).toEqual({ name: 'named' });

    const [found] = await this.querier.upsertMany(
      { $entity: Label, $conflict: { name: true }, $update: {} },
      [{ name: 'named' }],
      { returning: true },
    );
    expect(found).toEqual(await this.querier.findOne(Label, { $where: { name: 'named' } }));
  }

  /** `returning: true` reads each row back as a read naming no `$select` does, a row an upsert found included. */
  async shouldReturnEveryFieldAReadDoes() {
    const inserted = await this.querier.insertOne(Label, { name: 'whole' }, { returning: true });
    expect(inserted).toEqual(await this.querier.findOneById(Label, inserted.id));

    const found = await this.querier.upsertOne(
      Label,
      { $conflict: { name: true }, $update: {} },
      { name: 'whole' },
      {
        returning: true,
      },
    );
    expect(found).toEqual(await this.querier.findOneById(Label, inserted.id));

    const updated = await this.querier.updateMany(
      Label,
      { $where: { id: inserted.id } },
      { name: 'renamed' },
      { returning: true },
    );
    expect(updated).toEqual([await this.querier.findOneById(Label, inserted.id)]);
  }

  /** `returning: false` is what no option says: the write reports its id alone, and reads nothing back. */
  async shouldReportOnlyTheIdWhenReturningIsFalse() {
    const off = await this.querier.insertOne(Label, { name: 'off' }, { returning: false });

    expect(off).toEqual(expect.any(String));
    expect(await this.querier.findOneById(Label, off)).toMatchObject({ name: 'off' });
  }

  /** `returning` projects as `$select` does: a field set false leaves it out of every other field. */
  async shouldReturnWhatTheProjectionSelects() {
    const inserted = await this.querier.insertOne(Label, { name: 'a' }, { returning: { name: false } });

    expect(inserted).not.toHaveProperty('name');
    expect(inserted.id).toEqual(expect.any(String));
  }

  /** An update returns the rows it changed, named before it ran, so a payload moving them out of `$where` still does. */
  async shouldReturnTheRowsAnUpdateChanged() {
    await this.querier.insertMany(Parcel, [{ content: 'a' }, { content: 'b' }, { content: 'c' }]);

    const changed = await this.querier.updateMany(
      Parcel,
      { $where: { content: { $in: ['a', 'b'] } } },
      { content: 'moved' },
      { returning: { content: true } },
    );
    expect(changed).toEqual([{ content: 'moved' }, { content: 'moved' }]);
    expect(
      await this.querier.updateMany(
        Parcel,
        { $where: { content: 'gone' } },
        { content: 'x' },
        { returning: { content: true } },
      ),
    ).toEqual([]);
  }

  /** A delete returns the rows as they were before it, soft-deleted ones as they read. */
  async shouldReturnTheRowsADeleteRemoved() {
    const id = await this.querier.insertOne(Shipment, { name: 'gone' });

    const deleted = await this.querier.deleteOneById(Shipment, id!, { returning: { name: true } });
    expect(deleted).toEqual({ name: 'gone' });
    expect(await this.querier.count(Shipment)).toBe(0);
  }

  /** A pool stream inside the pool's transaction reads on its querier, the transaction's own writes included. */
  async shouldStreamThroughThePoolInsideItsTransaction() {
    const names = await this.pool.transaction(async (querier) => {
      await querier.insertOne(User, { name: 'streamed', email: 'streamed@example.com' });
      const rows = await Array.fromAsync(
        this.pool.findManyStream(User, { $select: { name: true }, $where: { email: 'streamed@example.com' } }),
      );
      return rows.map((row) => row.name);
    });

    expect(names).toEqual(['streamed']);
  }

  /** A pool stream from another flow never yields a row the transaction rolls back, however the race falls. */
  async shouldStreamAfterAnotherFlowsTransaction() {
    const { promise: inserted, resolve: insert } = Promise.withResolvers<void>();
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>();
    const transaction = this.pool.transaction(async (querier) => {
      await querier.insertOne(User, { name: 'pending', email: 'pending@example.com' });
      insert();
      await finished;
      throw new Error('rolled back');
    });
    await inserted;

    const streamed = Array.fromAsync(
      this.pool.findManyStream(User, { $select: { name: true }, $where: { email: 'pending@example.com' } }),
    );
    finish();

    await expect(transaction).rejects.toThrow('rolled back');
    expect(await streamed).toEqual([]);
  }

  /** A pool call the callback leaves running past its transaction runs on a querier of its own. */
  async shouldRunAPoolCallOutlivingItsTransaction() {
    let later: Promise<unknown> = Promise.resolve();
    await this.pool.transaction(async () => {
      later = new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
        this.pool.insertOne(User, { name: 'later', email: 'later@example.com' }),
      );
    });

    await later;
    expect(await this.querier.count(User, { $where: { email: 'later@example.com' } })).toBe(1);
  }

  /** By id, an update returns the row, or nothing where the id names none. */
  async shouldReturnTheRowAnUpdateByIdChanged() {
    const [id, goneId] = await this.querier.insertMany(Parcel, [{ content: 'a' }, { content: 'gone' }]);
    await this.querier.deleteOneById(Parcel, goneId!);

    expect(await this.querier.updateOneById(Parcel, id!, { content: 'b' }, { returning: { content: true } })).toEqual({
      content: 'b',
    });
    expect(
      await this.querier.updateOneById(Parcel, goneId!, { content: 'c' }, { returning: { content: true } }),
    ).toBeUndefined();
  }

  /** A hard delete returns a soft-deleted row too, which it removes; a delete matching nothing returns none. */
  async shouldReturnTheRowsAHardDeleteRemoved() {
    const id = await this.querier.insertOne(Shipment, { name: 'gone' });
    await this.querier.deleteOneById(Shipment, id!);

    const removed = await this.querier.deleteMany(
      Shipment,
      { $where: { name: 'gone' } },
      { hardDelete: true, returning: { name: true } },
    );
    expect(removed).toEqual([{ name: 'gone' }]);
    expect(
      await this.querier.deleteMany(Shipment, { $where: { name: 'gone' } }, { returning: { name: true } }),
    ).toEqual([]);
  }

  /** The rows a write wrote are its own, a soft-deleted one included. */
  async shouldReturnASoftDeletedRowAnInsertWrote() {
    expect(
      await this.querier.insertOne(Shipment, { name: 'archived', deletedAt: 1 }, { returning: { name: true } }),
    ).toEqual({ name: 'archived' });
  }

  /** An upsert writing relations updates the soft-deleted row its conflict finds, as `ON CONFLICT` does. */
  async shouldUpsertOntoASoftDeletedRow() {
    const id = await this.querier.insertOne(Shipment, { name: 'archived' });
    await this.querier.deleteOneById(Shipment, id!);

    await this.querier.upsertOne(
      Shipment,
      { $conflict: { id: true } },
      { id, name: 'back', carrier: { code: 'fast', name: 'Fast' } },
    );
    await this.querier.restoreOneById(Shipment, id!);

    const shipment = await this.querier.findOneById(Shipment, id!, { $populate: { carrier: true } });
    expect(shipment).toMatchObject({ name: 'back', carrier: { code: 'fast' } });
  }

  /** A plain upsert, one statement on SQL, updates the soft-deleted row its conflict finds too: never a second one. */
  async shouldUpsertPlainlyOntoASoftDeletedRow() {
    const id = await this.querier.insertOne(Shipment, { name: 'archived' });
    await this.querier.deleteOneById(Shipment, id!);

    await this.querier.upsertOne(Shipment, { $conflict: { id: true } }, { id, name: 'back' });
    await this.querier.restoreOneById(Shipment, id!);

    expect(await this.querier.findMany(Shipment, { $select: { name: true } })).toEqual([{ name: 'back' }]);
  }

  /** An upsert and a save return the row either branch wrote. */
  async shouldReturnTheRowAnUpsertWrote() {
    await this.querier.insertOne(Carrier, { code: 'fast', name: 'Fast' });

    const updated = await this.querier.upsertOne(
      Carrier,
      { $conflict: { code: true } },
      { code: 'fast', name: 'Faster' },
      {
        returning: { code: true, name: true },
      },
    );
    const saved = await this.querier.saveOne(Carrier, { code: 'slow', name: 'Slow' }, { returning: { name: true } });

    expect([updated, saved]).toEqual([{ code: 'fast', name: 'Faster' }, { name: 'Slow' }]);
  }

  /** A JSON value reads back as written: a string spelling a number, a boolean or a document stays a string. */
  async shouldReadJsonValuesBackAsWritten() {
    const values: NonNullable<JsonValue['value']>[] = ['123', 'true', '{"a":1}', 'plain', 42, true, { x: '7' }, ['1']];
    const holderId = await this.querier.insertOne(JsonHolder, { name: 'holder' });
    await this.querier.insertMany(
      JsonValue,
      values.map((value, position) => ({ holderId, position, value })),
    );

    const read = await this.querier.findMany(JsonValue, { $select: { value: true }, $sort: { position: 'asc' } });
    expect(read.map((row) => row.value)).toEqual(values);

    const holder = await this.querier.findOneById(JsonHolder, holderId!, {
      $populate: { values: { $select: { value: true }, $sort: { position: 'asc' } } },
    });
    expect(holder?.values?.map((row) => row.value)).toEqual(values);
  }

  /** An `undefined` filters by nothing, so a read naming one would return any row: it is refused. */
  async shouldRefuseAnUndefinedInAReadWhere() {
    await this.querier.insertMany(User, [{ name: 'one' }, { name: 'two' }]);

    await expect(this.querier.findOne(User, { $where: { name: undefined } })).rejects.toThrow(
      "$where on 'User' holds undefined at 'name'",
    );
    await expect(this.querier.count(User, { $where: { name: 'one', email: undefined } })).rejects.toThrow(
      "holds undefined at 'email'",
    );
  }

  /** A `$limit` names the rows a bulk write reaches, and `unfiltered` asks for every one. */
  async shouldBulkWriteTheRowsALimitOrUnfilteredNames() {
    await this.querier.insertMany(User, [{ name: 'one' }, { name: 'two' }]);

    await expect(this.querier.updateMany(User, { $limit: 1 }, { name: 'capped' })).resolves.toBe(1);
    await expect(this.querier.updateMany(User, {}, { name: 'renamed' }, { unfiltered: true })).resolves.toBe(2);
    await expect(this.querier.deleteMany(User, {}, { unfiltered: true })).resolves.toBe(2);
  }

  /**
   * The total counts every match, not the page cut out of it. SQL answers both from one statement,
   * carrying the total in a column of its own, so these also pin that the column never reaches the
   * entities it rode in on.
   */
  async shouldFindManyAndCountAPage() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
      { name: 'Charlie', email: 'charlie@test.com' },
    ]);

    const [page, total] = await this.querier.findManyAndCount(User, {
      $select: { name: true },
      $sort: { name: 1 },
      $skip: 1,
      $limit: 1,
    });

    expect(total).toBe(3);
    expect(page).toEqual([{ name: 'Bob' }]);
  }

  /** No page clauses: the total is the whole result, which the rows themselves already are. */
  async shouldFindManyAndCountWithoutAPage() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    const [rows, total] = await this.querier.findManyAndCount(User, { $sort: { name: 1 } });

    expect(total).toBe(2);
    expect(rows.map((it) => it.name)).toEqual(['Alice', 'Bob']);
  }

  /**
   * A `$skip` past the end empties the page while leaving the total untouched. No row comes back to
   * carry a total on, so this is the case the one-statement path has to answer some other way.
   */
  async shouldFindManyAndCountPastTheLastPage() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    await expect(this.querier.findManyAndCount(User, { $skip: 10 })).resolves.toEqual([[], 2]);
    await expect(this.querier.findManyAndCount(User, { $limit: 0 })).resolves.toEqual([[], 2]);
  }

  /**
   * The total counts the rows the read returns, so `$distinct` has to dedup it too: three rows over
   * two names is a total of two, not three. `COUNT(*)` alone counts before the deduplication, which
   * is why this needs a count of its own.
   */
  async shouldFindManyAndCountDistinctRows() {
    await this.querier.insertMany(User, [
      { name: 'dup', email: 'dc1@test.com' },
      { name: 'dup', email: 'dc2@test.com' },
      { name: 'uniq', email: 'dc3@test.com' },
    ]);

    const [rows, total] = await this.querier.findManyAndCount(User, {
      $select: { name: true },
      $distinct: true,
      $sort: { name: 1 },
    });

    expect(rows).toEqual([{ name: 'dup' }, { name: 'uniq' }]);
    expect(total).toBe(2);
  }

  /** The filter bounds the deduplicated total as well, and a page never shrinks it. */
  async shouldFindManyAndCountDistinctRowsOfAPage() {
    const [companyId, otherId] = await this.querier.insertMany(Company, [{ name: 'Acme' }, { name: 'Other' }]);
    await this.querier.insertMany(User, [
      { name: 'a', email: 'dp1@test.com', companyId },
      { name: 'a', email: 'dp2@test.com', companyId },
      { name: 'b', email: 'dp3@test.com', companyId },
      { name: 'c', email: 'dp4@test.com', companyId: otherId },
    ]);

    const [rows, total] = await this.querier.findManyAndCount(User, {
      $select: { name: true },
      $where: { companyId },
      $distinct: true,
      $limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(total).toBe(2);
  }

  /** Nothing matched, so the page is empty and so is the total, not the count of every row. */
  async shouldFindManyAndCountMatchingNothing() {
    await this.querier.insertMany(User, [{ name: 'Alice', email: 'alice@test.com' }]);

    await expect(this.querier.findManyAndCount(User, { $where: { name: 'nobody' } })).resolves.toEqual([[], 0]);
  }

  /** The filter still bounds the total when a page is taken out of it. */
  async shouldFindManyAndCountAFilteredPage() {
    const [companyId, otherId] = await this.querier.insertMany(Company, [{ name: 'Acme' }, { name: 'Other' }]);
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com', companyId },
      { name: 'Bob', email: 'bob@test.com', companyId },
      { name: 'Charlie', email: 'charlie@test.com', companyId: otherId },
    ]);

    const [page, total] = await this.querier.findManyAndCount(User, {
      $where: { companyId },
      $sort: { name: 1 },
      $limit: 1,
    });

    expect(total).toBe(2);
    expect(page.map((it) => it.name)).toEqual(['Alice']);
  }

  /**
   * A `$required` relation drops parents with no match, and the total counts what is left rather than
   * what the filter alone matched: a page of one out of one, not out of three the read can never
   * return. SQL reads it off the window in the joined statement; MongoDB counts past the `$unwind`.
   */
  async shouldFindManyAndCountThroughARequiredRelation() {
    const ids = await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
      { name: 'Charlie', email: 'charlie@test.com' },
    ]);
    await this.querier.insertOne(Profile, { picture: 'p', creatorId: ids[0] });

    const [rows, total] = await this.querier.findManyAndCount(User, { $populate: { profile: { $required: true } } });

    expect(rows.map((it) => it.name)).toEqual(['Alice']);
    expect(total).toBe(1);
  }

  async shouldFindManyStream() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
      { name: 'Charlie', email: 'charlie@test.com' },
    ]);

    const rows = await Array.fromAsync(this.querier.findManyStream(User, { $sort: { name: 1 } }));

    expect(rows.map(({ name }) => name)).toEqual(['Alice', 'Bob', 'Charlie']);

    const filtered = await Array.fromAsync(this.querier.findManyStream(User, { $where: { name: 'Bob' } }));
    expect(filtered.map(({ name }) => name)).toEqual(['Bob']);
  }

  async shouldFindManyStreamEmpty() {
    expect(await Array.fromAsync(this.querier.findManyStream(User, {}))).toEqual([]);
  }

  /** The stream sees the caller's uncommitted rows and leaves its transaction open for the statements after it. */
  async shouldFindManyStreamInsideATransaction() {
    const [rows, count] = await this.querier.transaction(async () => {
      await this.querier.insertMany(User, [
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' },
      ]);
      const streamed = await Array.fromAsync(this.querier.findManyStream(User, { $sort: { name: 1 } }));
      return [streamed, await this.querier.count(User, {})] as const;
    });

    expect(rows.map(({ name }) => name)).toEqual(['Alice', 'Bob']);
    expect(count).toBe(2);
  }

  /**
   * Past every driver's first batch, so the loop leaves the read mid-flight: the driver has to close it, and an
   * abandoned cursor holding its connection is what the next statement proves gone.
   */
  async shouldReleaseTheStreamWhenTheCallerStopsEarly() {
    await this.querier.insertMany(
      User,
      Array.from({ length: 250 }, (_, index) => ({ name: `u${String(index).padStart(3, '0')}` })),
    );

    const read: (string | null | undefined)[] = [];
    for await (const row of this.querier.findManyStream(User, { $sort: { name: 1 } })) {
      read.push(row.name);
      break;
    }

    expect(read).toEqual(['u000']);
    expect(await this.querier.count(User, {})).toBe(250);
  }

  /**
   * A stream holds its querier's connection until the loop ends, and most drivers would queue another
   * statement behind the read, which the loop never finishes: one is refused instead, on every engine.
   */
  async shouldRefuseAStatementOnTheQuerierAStreamHolds() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    const refusals: unknown[] = [];
    for await (const _row of this.querier.findManyStream(User, {})) {
      refusals.push(await this.querier.count(User, {}).catch(thrownValue));
      refusals.push(await this.querier.findManyStream(User, {})[Symbol.asyncIterator]().next().catch(thrownValue));
      break;
    }

    expect(refusals).toEqual([expect.any(UqlUsageError), expect.any(UqlUsageError)]);
    expect(await this.querier.count(User, {})).toBe(2);
  }

  /** `release` closes a stream left open, so the pool never takes back a connection still reading. */
  async shouldCloseAStreamLeftOpenAtRelease() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);
    const querier = await this.pool.getQuerier();
    const rows = querier.findManyStream(User, { $sort: { name: 1 } })[Symbol.asyncIterator]();
    await rows.next();

    await querier.release();

    expect(await rows.next()).toEqual({ done: true, value: undefined });
    expect(await this.pool.count(User)).toBe(2);
  }

  /** A stream answers each row as `findMany` does, null columns, to-ones and to-manys alike. */
  async shouldStreamTheRowsFindManyReads() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'weight' });
    await this.querier.insertMany(MeasureUnit, [{ name: 'kg', categoryId }, { name: 'orphan' }]);
    const units = { $populate: { category: true }, $sort: { name: 1 } } satisfies Query<MeasureUnit>;
    const categories = { $populate: { measureUnits: true } } satisfies Query<MeasureUnitCategory>;

    expect(await Array.fromAsync(this.querier.findManyStream(MeasureUnit, units))).toEqual(
      await this.querier.findMany(MeasureUnit, units),
    );
    expect(await Array.fromAsync(this.querier.findManyStream(MeasureUnitCategory, categories))).toEqual(
      await this.querier.findMany(MeasureUnitCategory, categories),
    );
  }

  async shouldStreamTwiceOverOneQuerier() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    const first = await Array.fromAsync(this.querier.findManyStream(User, { $sort: { name: 1 } }));
    const second = await Array.fromAsync(this.querier.findManyStream(User, { $sort: { name: -1 } }));

    expect(first.map((it) => it.name)).toEqual(['Alice', 'Bob']);
    expect(second.map((it) => it.name)).toEqual(['Bob', 'Alice']);
  }

  /**
   * Exact, never coerced: Postgres widens a SUM over BIGINT to NUMERIC and hands it back as text, and
   * MongoDB's `$group` answers with an `_id` the row does not declare.
   */
  async shouldAggregate() {
    await this.querier.insertMany(User, [
      { name: 'Alice', createdAt: 100 },
      { name: 'Bob', createdAt: 200 },
      { name: 'Charlie', createdAt: 300 },
    ]);

    const res = await this.querier.aggregate(User, {
      $where: { createdAt: { $gte: 200 } },
      $select: { total: { $sum: { createdAt: true } } },
    });

    expect(res).toEqual([{ total: 500 }]);
  }

  /** A soft delete stamps the row out of every read but one `withDeleted()` makes, and a restore brings it back. */
  async shouldSoftDeleteExcludeFromReadsAndRestore() {
    const id = await this.querier.insertOne(MeasureUnit, { name: 'unit' });

    expect(await this.querier.deleteOneById(MeasureUnit, id)).toBe(1);
    expect(await this.querier.findOneById(MeasureUnit, id)).toBeUndefined();
    expect(await this.querier.findOneById(MeasureUnit, id, {}, withDeleted())).toMatchObject({ id, name: 'unit' });
    expect(await this.querier.restoreOneById(MeasureUnit, id)).toBe(1);
    expect(await this.querier.findOneById(MeasureUnit, id)).toMatchObject({ id, name: 'unit' });
  }

  /** `withDeleted()` reaches the read's own rows, not its relations': a trashed joined row stays out. */
  async shouldKeepATrashedRelationOutOfAReadWithDeleted() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'trashed' });
    await this.querier.insertOne(MeasureUnit, { name: 'unit', categoryId });
    await this.querier.deleteOneById(MeasureUnitCategory, categoryId);

    const [unit] = await this.querier.findMany(
      MeasureUnit,
      { $select: { name: true }, $where: { categoryId }, $populate: { category: true } },
      withDeleted(),
    );

    expect(unit).toEqual({ name: 'unit' });
  }

  /**
   * "Only trashed" is a plain, serializable query: constraining the soft-delete field makes the default
   * `deletedAt IS NULL` filter step aside, and the live row still reads as ever.
   */
  async shouldListOnlyTrashed() {
    const [liveId, deadId] = await this.querier.insertMany(MeasureUnit, [{ name: 'live' }, { name: 'dead' }]);
    await this.querier.deleteOneById(MeasureUnit, deadId);

    const trashed = await this.querier.findMany(MeasureUnit, {
      $select: { id: true },
      $where: { deletedAt: { $ne: null } },
    });

    expect(trashed).toEqual([{ id: deadId }]);
    expect(await this.querier.findOneById(MeasureUnit, liveId)).toMatchObject({ id: liveId, name: 'live' });
  }

  async shouldRefuseALockTheEngineLacks() {
    await expect(this.querier.findMany(LedgerAccount, { $lock: true })).rejects.toThrow(
      'does not support row-level locking',
    );
  }

  async shouldHardDeletePermanently() {
    const id = await this.querier.insertOne(MeasureUnit, { name: 'gone' });
    expect(await this.querier.deleteOneById(MeasureUnit, id, { hardDelete: true })).toBe(1);
    expect(await this.querier.findOneById(MeasureUnit, id, {}, withDeleted())).toBeUndefined();
  }

  /**
   * Against real data: a category whose only matching unit is trashed must not match, and the count
   * must skip it, on every driver: MongoDB emulates the relation subqueries with `$lookup`.
   */
  async shouldNotMatchOrCountTrashedRowsThroughARelation() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'Weight' });
    const [liveId, trashedId] = await this.querier.insertMany(MeasureUnit, [
      { name: 'kg', categoryId },
      { name: 'stone', categoryId },
    ]);
    expect(await this.querier.deleteOneById(MeasureUnit, trashedId)).toBe(1);

    const byTrashed = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $where: { measureUnits: { name: 'stone' } },
    });
    expect(byTrashed).toEqual([]);

    const byLive = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $where: { measureUnits: { name: 'kg' } },
    });
    expect(byLive).toEqual([{ id: categoryId }]);

    const bySize = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $where: { measureUnits: { $size: 1 } },
    });
    expect(bySize).toEqual([{ id: categoryId }]);

    expect(await this.querier.findOneById(MeasureUnit, liveId)).toMatchObject({ name: 'kg' });
  }

  /**
   * A parent ranks by its related row nearest the vector, the smallest of their distances, in one read.
   * Every parent here has rows, since engines disagree about where one with none sorts.
   */
  async shouldRankByTheNearestRowOfAToMany() {
    const [far, near] = await this.querier.insertMany(VectorDoc, [{ name: 'far' }, { name: 'near' }]);
    await this.querier.insertMany(VectorChunk, [
      { name: 'far-a', vec: [0, 1, 0], vectorDocId: far },
      { name: 'far-b', vec: [Math.SQRT1_2, Math.SQRT1_2, 0], vectorDocId: far },
      { name: 'near-a', vec: [0, 0, 1], vectorDocId: near },
      { name: 'near-b', vec: [1, 0, 0], vectorDocId: near },
    ]);

    const docs = await this.querier.findMany(VectorDoc, {
      $select: { name: true },
      $sort: { chunks: { vec: { $vector: [1, 0, 0] } } },
    });

    expect(docs.map((doc) => doc.name)).toEqual(['near', 'far']);
  }

  /** A populated relation's rows in the order of their distance, each answering it under its `$project`. */
  async shouldProjectTheDistanceOfAPopulatedRelationsRows() {
    const doc = await this.querier.insertOne(VectorDoc, { name: 'doc' });
    await this.querier.insertMany(VectorChunk, [
      { name: 'far', vec: [0, 0, 1], vectorDocId: doc },
      { name: 'near', vec: [1, 0, 0], vectorDocId: doc },
    ]);

    const found = await this.querier.findOneById(VectorDoc, doc, {
      $select: { name: true },
      $populate: { chunks: { $select: { name: true }, $sort: { vec: { $vector: [1, 0, 0], $project: 'distance' } } } },
    });

    expect(found?.chunks.map((chunk) => chunk.name)).toEqual(['near', 'far']);
    expect(found?.chunks[0].distance).toBeCloseTo(0, 5);
    expect(found?.chunks[1].distance).toBeCloseTo(1, 5);
  }

  /** Each target once, however many links pair it, and never a column of the junction's. */
  async shouldRankByTheNearestTargetOfAManyToMany() {
    const [east, north, northeast] = await this.querier.insertMany(VectorChunk, [
      { name: 'east', vec: [1, 0, 0] },
      { name: 'north', vec: [0, 1, 0] },
      { name: 'northeast', vec: [Math.SQRT1_2, Math.SQRT1_2, 0] },
    ]);
    const [citesNorth, citesEast] = await this.querier.insertMany(VectorDoc, [
      { name: 'cites-north' },
      { name: 'cites-east' },
    ]);
    await this.querier.insertMany(VectorCitation, [
      { vectorDocId: citesNorth, vectorChunkId: north },
      { vectorDocId: citesNorth, vectorChunkId: northeast },
      { vectorDocId: citesEast, vectorChunkId: east },
    ]);

    const docs = await this.querier.findMany(VectorDoc, {
      $select: { name: true },
      $sort: { cited: { vec: { $vector: [0, 1, 0], $distance: 'l2' } } },
    });

    expect(docs.map((doc) => doc.name)).toEqual(['cites-north', 'cites-east']);
  }

  /** An aggregate over a many-to-many reads its targets' columns, not the junction rows pairing them. */
  async shouldAggregateAColumnOfAManyToManyTarget() {
    const [east, north] = await this.querier.insertMany(VectorChunk, [{ name: 'east' }, { name: 'north' }]);
    const vectorDocId = await this.querier.insertOne(VectorDoc, { name: 'doc' });
    await this.querier.insertMany(VectorCitation, [
      { vectorDocId, vectorChunkId: east },
      { vectorDocId, vectorChunkId: north },
    ]);

    const doc = await this.querier.findOneById(VectorDoc, vectorDocId, { $select: { lastCited: true } });

    expect(doc?.lastCited).toBe('north');
  }

  /** A to-one ranks the same way, with no join and nothing populated. */
  async shouldRankByAToOneWithoutPopulatingIt() {
    const [east, north] = await this.querier.insertMany(VectorDoc, [
      { name: 'east', vec: [1, 0, 0] },
      { name: 'north', vec: [0, 1, 0] },
    ]);
    await this.querier.insertMany(VectorChunk, [
      { name: 'b', vectorDocId: north },
      { name: 'a', vectorDocId: north },
      { name: 'c', vectorDocId: east },
    ]);

    const chunks = await this.querier.findMany(VectorChunk, {
      $select: { name: true },
      $sort: { doc: { vec: { $vector: [0, 1, 0] } }, name: 1 },
    });

    expect(chunks.map((chunk) => chunk.name)).toEqual(['a', 'b', 'c']);
  }
}
