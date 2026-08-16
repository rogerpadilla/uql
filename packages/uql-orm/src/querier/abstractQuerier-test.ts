import { expect } from 'vitest';
import { getEntities } from '../entity/index.js';
import {
  Company,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  LedgerAccount,
  MeasureUnit,
  MeasureUnitCategory,
  type Spec,
  Tag,
  Tax,
  TaxCategory,
  User,
} from '../test/index.js';
import type { Querier, QuerierPool, Type } from '../type/index.js';
import { withDeleted } from '../util/index.js';

export abstract class AbstractQuerierIt<Q extends Querier> implements Spec {
  querier!: Q;

  constructor(protected pool: QuerierPool<Q>) {}

  async beforeAll() {
    const querier = await this.pool.getQuerier();
    try {
      this.querier = querier;
      await this.dropTables();
      await this.createTables();
    } finally {
      await querier.release();
      this.querier = undefined as any;
    }
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

  /**
   * Every driver inherits `Symbol.asyncDispose` from `AbstractQuerier`, so `await using` has to
   * release on any backend. Takes its own querier rather than `this.querier`, which the harness owns,
   * and counts calls by wrapping `release` instead of mocking: this suite also runs under `bun:test`.
   */
  async shouldReleaseOnAsyncDispose() {
    const querier = await this.pool.getQuerier();
    const release = querier.release.bind(querier);
    let releases = 0;
    querier.release = async () => {
      releases++;
      return release();
    };

    {
      await using scoped = querier;
      await scoped.count(User);
    }

    expect(releases).toBe(1);
  }

  /** The release still happens when the block exits through a throw. */
  async shouldReleaseOnAsyncDisposeWhenBodyThrows() {
    const querier = await this.pool.getQuerier();
    const release = querier.release.bind(querier);
    let releases = 0;
    querier.release = async () => {
      releases++;
      return release();
    };

    const failed = await (async () => {
      await using scoped = querier;
      await scoped.count(User);
      throw new Error('boom');
    })().then(
      () => undefined,
      (err: Error) => err.message,
    );

    expect(failed).toBe('boom');
    expect(releases).toBe(1);
  }

  /** Each pool call is its own acquire/run/release, which is why the read below sees the write above. */
  async shouldRunOperationsOnThePool() {
    const id = await this.pool.insertOne(User, {
      name: 'Pool Write',
      email: 'poolwrite@example.com',
      password: '123456789p!',
    });
    expect(id).toBeDefined();

    const updated = await this.pool.updateMany(User, { $where: { id } }, { name: 'Pool Write Renamed' });
    expect(updated).toBe(1);

    const found = await this.pool.findOneById(User, id, { $select: { name: true } });
    expect(found).toMatchObject({ name: 'Pool Write Renamed' });

    expect(await this.pool.deleteMany(User, { $where: { id } })).toBe(1);
    expect(await this.pool.count(User, { $where: { id } })).toBe(0);
  }

  /** The one pool call whose connection outlives the call itself: it is held until the loop ends. */
  async shouldStreamFromThePool() {
    await this.pool.insertMany(User, [
      { name: 'Stream A', email: 'streama@example.com', password: '123456789a!' },
      { name: 'Stream B', email: 'streamb@example.com', password: '123456789b!' },
    ]);

    const names: (string | undefined)[] = [];
    for await (const user of this.pool.findManyStream(User, { $select: { name: true }, $sort: { name: 1 } })) {
      names.push(user.name);
    }
    expect(names).toEqual(['Stream A', 'Stream B']);

    // The pool still hands one out, so the loop gave its connection back.
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
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
  }

  async shouldInsertManyEmpty() {
    const ids = await this.querier.insertMany(User, []);
    expect(ids).toEqual([]);
  }

  async shouldInsertOne() {
    const creatorId = await this.querier.insertOne(User, {
      name: 'Some Name C',
      email: 'someemailc@example.com',
      password: '123456789z!',
    });
    expect(creatorId).toBeDefined();

    const companyId = await this.querier.insertOne(Company, {
      name: 'Some Name C',
      creatorId,
    });
    expect(companyId).toBeDefined();

    const taxCategoryId = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name C',
      description: 'Some Description Z',
      creatorId,
      companyId,
    });
    expect(taxCategoryId).toBeDefined();
  }

  async shouldInsertOneWithOnInsertId() {
    const id1 = await this.querier.insertOne(TaxCategory, {
      name: 'Some Name',
    });
    const id2 = await this.querier.insertOne(TaxCategory, {
      pk: '123',
      name: 'Some Name',
    });
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
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
    expect(ids).toHaveLength(4);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
  }

  async shouldInsertManyWithAutoIncrementIdAsDefault() {
    const ids = await this.querier.insertMany(LedgerAccount, [
      {
        name: 'Some Name A',
      },
      {
        name: 'Some Name B',
      },
      {
        name: 'Some Name C',
      },
    ]);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
    const founds = await this.querier.findMany(LedgerAccount, {});
    expect(founds.map(({ id }) => id)).toEqual(ids);
  }

  async shouldInsertManyWithHeterogeneousFieldSets() {
    const ids = await this.querier.insertMany(User, [
      { name: 'Het A', email: 'heta@example.com', password: '123456789a!' },
      { name: 'Het B' },
    ]);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(id).toBeDefined();
    }
    const founds = await this.querier.findMany(User, {
      $select: { id: true, name: true, email: true },
      $where: { name: ['Het A', 'Het B'] },
      $sort: { name: 1 },
    });
    expect(founds).toHaveLength(2);
    expect(founds[0]).toMatchObject({ name: 'Het A', email: 'heta@example.com' });
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
    expect(id).toBeDefined();
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

    expect(id).toBeDefined();

    const found = await this.querier.findOneById(MeasureUnit, id, { $populate: { category: true } });

    expect(found).toMatchObject({ id, category: payload.category });
  }

  async shouldInsertSpecialChars() {
    const payload: MeasureUnit = {
      name: `I'm Cielo! How are you doing today? It's been a while since we last talked`,
      createdAt: 123,
    };

    const id = await this.querier.insertOne(MeasureUnit, payload);

    expect(id).toBeDefined();

    const found = await this.querier.findOneById(MeasureUnit, id);

    expect(found).toMatchObject(payload);
  }

  async shouldInsertOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const date = new Date();

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      date,
      itemAdjustments,
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: true },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldInsertOneAndCascadeOneToManyWithSpecificFields() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
      itemAdjustments: itemAdjustments.slice(),
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: { $select: { buyPrice: true } } },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldThrowWhenSelectAndExcludeConflict() {
    await expect(
      this.querier.findMany(User, {
        $select: { name: true },
        $exclude: { createdAt: true },
      }),
    ).rejects.toThrow('Cannot combine $select and $exclude');
  }

  async shouldUpdateOneAndCascadeOneToMany() {
    const itemAdjustments: ItemAdjustment[] = [{ buyPrice: 50 }, { buyPrice: 300 }];

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some description',
    });

    expect(inventoryAdjustmentId).toBeDefined();

    const changes = await this.querier.updateOneById(InventoryAdjustment, inventoryAdjustmentId, {
      itemAdjustments,
    });

    expect(changes).toBe(1);

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: { $select: { buyPrice: true } } },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments,
    });

    const itemAdjustmentsFound = await this.querier.findMany(ItemAdjustment, { $where: { inventoryAdjustmentId } });

    expect(itemAdjustmentsFound).toMatchObject(itemAdjustments);
  }

  async shouldUpdateOneByIdAndCascadeOneToManyNull() {
    const id = await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(2);

    await this.querier.updateOneById(InventoryAdjustment, id, {
      itemAdjustments: null as any,
    });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(0);
  }

  async shouldUpdateManyAndCascadeOneToManyNull() {
    await this.querier.insertOne(InventoryAdjustment, { itemAdjustments: [{}, {}] });

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(2);

    await this.querier.updateMany(
      InventoryAdjustment,
      { $where: {} },
      {
        itemAdjustments: null as any,
      },
    );

    await expect(this.querier.count(ItemAdjustment, {})).resolves.toBe(0);
  }

  async shouldInsertOneAndCascadeManyToMany() {
    const payload: Item = {
      name: 'item one',
      createdAt: 1,
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

    const id = await this.querier.insertOne(Item, payload);

    expect(id).toBeDefined();

    const foundItem = await this.querier.findOneById(Item, id, {
      $select: { name: true, createdAt: true },
      $populate: { tags: { $select: { name: true, createdAt: true } } },
    });

    expect(foundItem).toMatchObject({
      id,
      ...payload,
    });

    const foundTags = await this.querier.findMany(Tag, {
      $select: { name: true, createdAt: true },
      $populate: { items: { $select: { name: true, createdAt: true } } },
    });

    delete (foundItem as any).tags;

    expect(foundTags).toMatchObject(payload.tags!.map((tag) => ({ ...tag, items: [foundItem] })));
  }

  /**
   * Narrowing a query used to cost it its projection on MongoDB: populating a relation forces the
   * aggregation path, which emitted no `$project` at all and handed back every column.
   */
  async shouldNarrowTheProjectionWhilePopulatingAJoinedRelation() {
    const measureUnitId = await this.querier.insertOne(MeasureUnit, { name: 'unit one' });
    const id = await this.querier.insertOne(Item, { name: 'item one', salePrice: 5, measureUnitId });

    const found = await this.querier.findOneById(Item, id, {
      $exclude: { salePrice: true },
      $populate: { measureUnit: { $select: { name: true } } },
    });

    expect(found).toMatchObject({ id, name: 'item one', measureUnit: { name: 'unit one' } });
    expect('salePrice' in found!).toBe(false);
    // the relation's own projection narrows too, inside the join
    expect('categoryId' in found!.measureUnit!).toBe(false);
  }

  /** A joined document keeps its own key on every engine, exactly as the parent's does. */
  async shouldKeepAJoinedRelationsIdDespite$exclude() {
    const measureUnitId = await this.querier.insertOne(MeasureUnit, { name: 'unit one' });
    const id = await this.querier.insertOne(Item, { name: 'item one', measureUnitId });

    const found = await this.querier.findOneById(Item, id, {
      $populate: { measureUnit: { $exclude: { id: true } } },
    });

    expect(found!.measureUnit).toMatchObject({ id: measureUnitId, name: 'unit one' });
  }

  /** A relation query names the target's columns, so a m2m one must not reach the join table. */
  async shouldPopulateManyToManyWith$exclude() {
    const id = await this.querier.insertOne(Item, {
      name: 'item one',
      createdAt: 1,
      tags: [{ name: 'tag one', createdAt: 1 }],
    });

    const found = await this.querier.findOneById(Item, id, {
      $populate: { tags: { $exclude: { name: true } } },
    });

    expect(found!.tags).toHaveLength(1);
    expect('name' in found!.tags![0]).toBe(false);
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

    expect(found!.tags).toMatchObject([{ name: 'keep' }]);
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
      $select: { name: true, updatedAt: true },
      $populate: { tags: true },
    });

    expect(found).toMatchObject({
      id,
      ...payload,
    });
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
    expect(found?.kind).toBeDefined();
    expect(found?.kind).toMatchObject({ public: 1, private: 1, tags: ['a', 'b'] });

    const pushResult = await this.querier.updateOneById(Company, id, {
      kind: { $push: { tags: 'c' } },
    });
    expect(pushResult).toBe(1);

    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toMatchObject({ public: 1, private: 1, tags: ['a', 'b', 'c'] });

    const unsetResult = await this.querier.updateOneById(Company, id, {
      kind: { $unset: ['public'] },
    });
    expect(unsetResult).toBe(1);

    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toMatchObject({ private: 1, tags: ['a', 'b', 'c'] });
    expect(found?.kind).not.toHaveProperty('public');
  }

  /** `$pull` removes every matching element, and is a no-op when there is nothing to remove. */
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
    expect(found?.kind).toMatchObject({ public: 1, tags: ['b', 'c'] });

    // No matching element leaves the array untouched.
    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'absent' } } });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toMatchObject({ public: 1, tags: ['b', 'c'] });

    // Pulling the last element leaves an empty array, not a missing key.
    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'b' } } });
    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'c' } } });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toMatchObject({ public: 1, tags: [] });
  }

  /**
   * `$pull` and `$push` on the same key in one payload: the pull is applied to the stored array and
   * the push appends to the pulled result. Regression guard for the expression-composition rules -
   * a `$push` sourcing its array from the raw column would silently discard the `$pull`.
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

    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toMatchObject({ private: 1, tags: ['b', 'fresh'] });
    expect(found?.kind).not.toHaveProperty('public');
  }

  /**
   * `$set` and `$push` on the same key: the set replaces the array, the push appends to that result.
   * MongoDB rejects two operators on one path in a single update document, so this is what forces the
   * aggregation-pipeline form there while the SQL dialects compose expressions.
   */
  async shouldCombineJsonSetAndPushOnSameKey() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Set Push',
      kind: { public: 1, tags: ['stale'] },
    });

    const result = await this.querier.updateOneById(Company, id, {
      kind: { $set: { tags: ['kept'] }, $push: { tags: 'appended' } },
    });
    expect(result).toBe(1);

    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found!.kind).toMatchObject({ public: 1, tags: ['kept', 'appended'] });
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

    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found!.kind).toMatchObject({ public: 1, country: 'US' });
    expect(found!.kind).not.toHaveProperty('private');
  }

  /** A `$pull` on an absent key is a no-op: it must not create the key or null the document. */
  async shouldPullFromMissingJsonKeyAsNoop() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Pull Missing',
      kind: { public: 1 },
    });

    await this.querier.updateOneById(Company, id, { kind: { $pull: { tags: 'a' } } });

    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1 });
  }

  /**
   * The `$pull` on the absent `labels` stays a no-op even when another key in the same payload has
   * to be composed differently (on MongoDB that combination switches the whole update to an
   * aggregation pipeline, where an unguarded filter would create `labels` as an empty array).
   */
  async shouldPullFromMissingJsonKeyWhileCombining() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Pull Missing Combined',
      kind: { public: 1, tags: ['a', 'b'] },
    });

    await this.querier.updateOneById(Company, id, {
      kind: { $pull: { tags: 'a', labels: 'x' }, $push: { tags: 'z' } },
    });

    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, tags: ['b', 'z'] });
  }

  /**
   * Filtering and sorting by a JSON dot-path. Regression: MySQL's `->>` needs a full JSON path
   * (`'$.public'`), so the base's `col->>'public'` failed at runtime with "Invalid JSON path
   * expression" - covered only by unit specs asserting that same invalid text until now.
   */
  async shouldFindAndSortByJsonDotPath() {
    await this.querier.insertOne(Company, { name: 'JSON Scalar One', kind: { public: 1 } });
    await this.querier.insertOne(Company, { name: 'JSON Scalar Zero', kind: { public: 0 } });

    const founds = await this.querier.findMany(Company, { $where: { 'kind.public': 1 } });
    expect(founds.map(({ name }) => name)).toEqual(['JSON Scalar One']);

    const sorted = await this.querier.findMany(Company, { $sort: { 'kind.public': -1 } });
    expect(sorted.map(({ name }) => name)).toEqual(['JSON Scalar One', 'JSON Scalar Zero']);
  }

  /**
   * Filtering, ordering and populating in one read. Regression on MongoDB: the `$match` and the
   * `$sort` were emitted as one stage object, which the server rejects outright ("a pipeline stage
   * specification object must contain exactly one field"), so any query combining the three failed.
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

  /**
   * A relation of a relation comes back filled, at every level the query asked for. Regression on
   * MongoDB: only the first `$lookup` ran while the projection still asked for the nested key, so
   * `tax.category` arrived empty with no error, and the two backends disagreed in silence.
   */
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
   * Ordering a to-many relation's own rows: `$sort` inside `$populate` orders the second query the
   * children are loaded with, which is where "each parent with its children in order" lives. The
   * parent-level `$sort` cannot express it - it orders parents, and a parent has many children.
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

  /**
   * Ordering the rows by a field of a related entity, which every backend here can do for a
   * populated to-one - the SQL dialects by the join `$populate` already put under it, MongoDB by the
   * document its `$lookup` unwound. Regression: the SQL dialects emitted `ORDER BY "tax"."name"`
   * against a statement that joined nothing whenever `$populate` was left out, and read the column
   * name off the *parent* entity, so a related `@Field({ name })` resolved to a column that does not
   * exist.
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

    const founds = await this.querier.findMany(Item, {
      $select: { name: true },
      $populate: { tax: { $select: { name: true } } },
      $where: { name: { $startsWith: 'sorted by ' } },
      $sort: { tax: { name: 1 } },
    });

    expect(founds.map(({ name }) => name)).toEqual(['sorted by alpha', 'sorted by zulu']);
  }

  /**
   * Boolean and numeric operands against a JSON dot-path. Regression: comparing a JSON *text*
   * extraction to a boolean raises `operator does not exist: text = boolean` on drivers that send
   * typed parameters, and on MySQL silently matched nothing (`'true'` vs `1`); `$in` had the same
   * problem for numbers.
   */
  async shouldFindByJsonDotPathTypedOperands() {
    await this.querier.insertOne(Company, { name: 'JSON Typed On', kind: { isArchived: true, public: 1 } });
    await this.querier.insertOne(Company, { name: 'JSON Typed Off', kind: { isArchived: false, public: 0 } });

    const byTrue = await this.querier.findMany(Company, { $where: { 'kind.isArchived': true } });
    expect(byTrue.map(({ name }) => name)).toEqual(['JSON Typed On']);

    const byFalse = await this.querier.findMany(Company, { $where: { 'kind.isArchived': { $ne: true } } });
    expect(byFalse.map(({ name }) => name)).toEqual(['JSON Typed Off']);

    const byIn = await this.querier.findMany(Company, { $where: { 'kind.public': { $in: [1] } } });
    expect(byIn.map(({ name }) => name)).toEqual(['JSON Typed On']);

    const byInBoth = await this.querier.findMany(Company, { $where: { 'kind.public': { $in: [0, 1] } } });
    expect(byInBoth).toHaveLength(2);
  }

  /**
   * `$elemMatch` over object elements, both as containment and with per-field operators. Regression:
   * the per-field form read every element field as text, so a boolean condition compared `'true'`
   * against `1` and silently matched nothing on MySQL (and raised `text = boolean` on strict drivers).
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

    const byContainment = await this.querier.findMany(Company, {
      $where: { 'kind.items': { $elemMatch: { name: 'first' } } },
    });
    expect(byContainment.map(({ name }) => name)).toEqual(['JSON Elem Active']);

    const byBoolean = await this.querier.findMany(Company, {
      $where: { 'kind.items': { $elemMatch: { active: { $eq: true } } } },
    });
    expect(byBoolean.map(({ name }) => name)).toEqual(['JSON Elem Active']);

    const byMixed = await this.querier.findMany(Company, {
      $where: { 'kind.items': { $elemMatch: { active: { $eq: false }, name: { $startsWith: 'sec' } } } },
    });
    expect(byMixed.map(({ name }) => name)).toEqual(['JSON Elem Idle']);
  }

  /**
   * `$elemMatch` shapes that used to be handled inconsistently: plain equality bypassed the
   * condition builder (so a number lost its cast and `null` became `= NULL`), an empty match
   * produced invalid SQL on SQLite, and an operator applied to a scalar element took an
   * accessor no test reached.
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

    // Plain equality and its explicit `$eq` spelling must agree.
    const byPlain = await this.querier.findMany(Company, { $where: { 'kind.items': { $elemMatch: { count: 5 } } } });
    expect(byPlain.map(({ name }) => name)).toEqual(['JSON Edge Counted']);
    const byEq = await this.querier.findMany(Company, {
      $where: { 'kind.items': { $elemMatch: { count: { $eq: 5 } } } },
    });
    expect(byEq.map(({ name }) => name)).toEqual(['JSON Edge Counted']);

    // A null element field is a null check, not `= NULL`.
    const byNull = await this.querier.findMany(Company, { $where: { 'kind.items': { $elemMatch: { note: null } } } });
    expect(byNull.map(({ name }) => name)).toEqual(['JSON Edge Counted']);

    // An operator applied to the element itself, on an array of scalars.
    const byFlag = await this.querier.findMany(Company, {
      $where: { 'kind.flags': { $elemMatch: { $eq: true } } },
    });
    expect(byFlag.map(({ name }) => name)).toEqual(['JSON Edge Counted']);
  }

  /**
   * Array operators applied to a JSON dot-path. Regression: `$size`/`$all`/`$elemMatch` on a path
   * used to throw on SQLite (the base dialect had no implementation) and emit invalid SQL on MariaDB
   * (`col->'key'` is a syntax error there), while SQLite's `$all` never matched a string element.
   */
  async shouldFindByJsonDotPathArrayOperators() {
    await this.querier.insertOne(Company, { name: 'JSON Path Two', kind: { tags: ['a', 'b'] } });
    await this.querier.insertOne(Company, { name: 'JSON Path One', kind: { tags: ['c'] } });

    const bySize = await this.querier.findMany(Company, { $where: { 'kind.tags': { $size: 2 } } });
    expect(bySize.map(({ name }) => name)).toEqual(['JSON Path Two']);

    const byAll = await this.querier.findMany(Company, { $where: { 'kind.tags': { $all: ['b', 'a'] } } });
    expect(byAll.map(({ name }) => name)).toEqual(['JSON Path Two']);

    const byMissing = await this.querier.findMany(Company, { $where: { 'kind.tags': { $all: ['absent'] } } });
    expect(byMissing).toEqual([]);
  }

  /** `$push` onto an absent key creates the array, consistently across every dialect. */
  async shouldPushOntoMissingJsonKey() {
    const id = await this.querier.insertOne(Company, {
      name: 'JSON Company Push Missing',
      kind: { public: 1 },
    });

    await this.querier.updateOneById(Company, id, { kind: { $push: { tags: 'first' } } });

    const found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toEqual({ public: 1, tags: ['first'] });
  }

  /** Regression: JSONB $set must persist boolean true and false (not only numeric/string values). */
  async shouldSetJsonBooleanField() {
    const id = await this.querier.insertOne(Company, {
      name: 'Bool JSON merge',
      kind: { description: 'x' },
    });

    await this.querier.updateOneById(Company, id, {
      kind: { $set: { isArchived: true } },
    });
    let found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found!.kind).toBeInstanceOf(Object);
    expect(found!.kind!.isArchived).toBe(true);

    await this.querier.updateOneById(Company, id, {
      kind: { $set: { isArchived: false } },
    });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found!.kind!.isArchived).toBe(false);
  }

  async shouldUpsertOne() {
    const pk = '507f1f77bcf86cd799439011';
    const record1 = await this.querier.findOne(TaxCategory, {
      $select: { name: true },
      $where: { pk },
    });
    expect(record1).toBeUndefined();
    const insertResult = await this.querier.upsertOne(
      TaxCategory,
      { pk: true },
      {
        pk,
        name: 'Some Name C',
      },
    );
    expect(insertResult.changes).toBeGreaterThanOrEqual(1);
    expect(insertResult.firstId).toBeDefined();
    const record2 = await this.querier.findOne(TaxCategory, {
      $select: { name: true },
      $where: { pk },
    });
    expect(record2).toMatchObject({
      name: 'Some Name C',
    });
    const updateResult = await this.querier.upsertOne(
      TaxCategory,
      { pk: true },
      {
        pk,
        name: 'Some Name D',
      },
    );
    expect(updateResult.changes).toBeGreaterThanOrEqual(1);
    expect(updateResult.firstId).toBeDefined();
    const record3 = await this.querier.findOne(TaxCategory, {
      $select: { name: true },
      $where: { pk },
    });
    expect(record3).toMatchObject({
      name: 'Some Name D',
    });
  }

  async shouldUpsertManyEmpty() {
    const result = await this.querier.upsertMany(TaxCategory, { pk: true }, []);
    expect(result.changes).toBe(0);
  }

  async shouldUpsertMany() {
    const pk1 = '507f1f77bcf86cd799439021';
    const pk2 = '507f1f77bcf86cd799439022';

    // Verify records don't exist
    const existing1 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk1 } });
    const existing2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk2 } });
    expect(existing1).toBeUndefined();
    expect(existing2).toBeUndefined();

    // Insert via upsertMany
    const insertResult = await this.querier.upsertMany(TaxCategory, { pk: true }, [
      { pk: pk1, name: 'Upsert A' },
      { pk: pk2, name: 'Upsert B' },
    ]);
    expect(insertResult.changes).toBeGreaterThanOrEqual(2);

    const inserted1 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk1 } });
    const inserted2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk2 } });
    expect(inserted1).toMatchObject({ name: 'Upsert A' });
    expect(inserted2).toMatchObject({ name: 'Upsert B' });

    // Update via upsertMany (same keys, different names)
    const updateResult = await this.querier.upsertMany(TaxCategory, { pk: true }, [
      { pk: pk1, name: 'Updated A' },
      { pk: pk2, name: 'Updated B' },
    ]);
    expect(updateResult.changes).toBeGreaterThanOrEqual(2);

    const updated1 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk1 } });
    const updated2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk2 } });
    expect(updated1).toMatchObject({ name: 'Updated A' });
    expect(updated2).toMatchObject({ name: 'Updated B' });
  }

  async shouldFindOne() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    const found = await this.querier.findOne(User, {
      $select: { id: true, name: true, email: true, password: true },
      $where: {
        email: 'someemaila@example.com',
      },
    });

    expect(found).toMatchObject({
      name: 'Some Name A',
      email: 'someemaila@example.com',
      password: '123456789a!',
    });

    const notFound = await this.querier.findOne(User, {
      $where: {
        name: 'some name',
      },
    });

    expect(notFound).toBeUndefined();
  }

  async shouldCount() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.count(User, {})).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: null } as any })).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: 1 } })).resolves.toBe(0);
  }

  async shouldUpdateMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.updateMany(User, { $where: { companyId: 1 } }, { companyId: null as any })).resolves.toBe(
      0,
    );
    await expect(this.querier.updateMany(User, { $where: { companyId: null } as any }, { companyId: 1 })).resolves.toBe(
      3,
    );
    await expect(this.querier.updateMany(User, { $where: { companyId: 1 } }, { companyId: null as any })).resolves.toBe(
      3,
    );
  }

  async shouldThrowIfUnknownComparisonOperator() {
    await expect(
      this.querier.findMany(User, {
        $where: { name: { $someInvalidOperator: 'some' } as any },
      }),
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  async shouldThrowWhenRollbackTransactionWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldCommit() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.beginTransaction();
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.commitTransaction();
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.release();
  }

  async shouldRollback() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.beginTransaction();
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.rollbackTransaction();
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.release();
  }

  async shouldCommitWithIsolationLevel() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.beginTransaction({ isolationLevel: 'serializable' });
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.commitTransaction();
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.release();
  }

  async shouldRollbackWithIsolationLevel() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.beginTransaction({ isolationLevel: 'read committed' });
    await this.querier.insertOne(User, {});
    await expect(this.querier.count(User, {})).resolves.toBe(1);
    await this.querier.rollbackTransaction();
    await expect(this.querier.count(User, {})).resolves.toBe(0);
    await this.querier.release();
  }

  async shouldTransactionCallbackWithIsolationLevel() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);
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

  async shouldThrowWhenBeginTransactionAfterBeginTransaction() {
    expect(this.querier.hasOpenTransaction).toBeFalsy();
    await this.querier.beginTransaction();
    expect(this.querier.hasOpenTransaction).toBe(true);
    await expect(this.querier.beginTransaction()).rejects.toThrow('pending transaction');
    await expect(this.querier.release()).rejects.toThrow('pending transaction');
    await this.querier.rollbackTransaction();
    await this.querier.release();
  }

  async shouldReturnTransactionValue() {
    const affectedRows = await this.querier.transaction(async () => {
      await this.shouldInsertMany();
      const count = await this.querier.count(User, {});
      await this.querier.deleteMany(User, {});
      return count;
    });
    expect(affectedRows).toBe(2);
  }

  async shouldReuseTransactionWhenNested() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    const result = await this.querier.transaction(async () => {
      await this.querier.insertOne(User, { name: 'outer' });

      // Nested transaction should reuse the outer one
      const innerResult = await this.querier.transaction(async () => {
        await this.querier.insertOne(User, { name: 'inner' });
        return this.querier.count(User, {});
      });

      expect(innerResult).toBe(2);
      return innerResult;
    });

    expect(result).toBe(2);
    await expect(this.querier.count(User, {})).resolves.toBe(2);
  }

  async shouldRollbackEntireTransactionWhenNestedThrows() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    await expect(
      this.querier.transaction(async () => {
        await this.querier.insertOne(User, { name: 'outer' });
        await this.querier.transaction(async () => {
          await this.querier.insertOne(User, { name: 'inner' });
          throw new Error('inner error');
        });
      }),
    ).rejects.toThrow('inner error');

    // Both outer and inner inserts should be rolled back
    await expect(this.querier.count(User, {})).resolves.toBe(0);
  }

  async shouldReuseDeeplyNestedTransactions() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    const result = await this.querier.transaction(async () => {
      await this.querier.insertOne(User, { name: 'level-1' });
      return this.querier.transaction(async () => {
        await this.querier.insertOne(User, { name: 'level-2' });
        return this.querier.transaction(async () => {
          await this.querier.insertOne(User, { name: 'level-3' });
          return this.querier.count(User, {});
        });
      });
    });

    expect(result).toBe(3);
    await expect(this.querier.count(User, {})).resolves.toBe(3);
  }

  async shouldThrowWhenCommitTransactionWithoutBeginTransaction() {
    await expect(this.querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  }

  async shouldSelectOneToManyEmpty() {
    const inventoryAdjustment = await this.querier.findOneById(InventoryAdjustment, -1, {
      $populate: { itemAdjustments: true, creator: true },
    });
    expect(inventoryAdjustment).toBeUndefined();

    const inventoryAdjustments = await this.querier.findMany(InventoryAdjustment, {
      $populate: { itemAdjustments: true },
    });
    expect(inventoryAdjustments).toHaveLength(0);
  }

  async shouldSelectOneToMany() {
    await this.shouldInsertOne();

    const [user, company] = await Promise.all([
      this.querier.findOne(User, { $select: { id: true } }),
      this.querier.findOne(Company, { $select: { id: true } }),
    ]);

    const user_ = user!;
    const company_ = company!;

    const [firstItemId, secondItemId] = await this.querier.insertMany(Item, [
      {
        name: 'some item name a',
        creatorId: user_.id,
        companyId: company_.id,
      },
      {
        name: 'some item name b',
        creatorId: user_.id,
        companyId: company_.id,
      },
    ]);

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some inventory adjustment',
      creatorId: user_.id,
      companyId: company_.id,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
    });

    const inventoryAdjustmentFound = await this.querier.findOneById(InventoryAdjustment, inventoryAdjustmentId, {
      $populate: { itemAdjustments: true, creator: true },
    });

    expect(inventoryAdjustmentFound).toMatchObject({
      id: inventoryAdjustmentId,
      itemAdjustments: [
        { buyPrice: 1000, itemId: firstItemId },
        { buyPrice: 2000, itemId: secondItemId },
      ],
      creator: {
        email: 'someemailc@example.com',
        name: 'Some Name C',
      },
    });
  }

  async shouldDeleteMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);
    await expect(this.querier.deleteMany(User, { $where: { companyId: 1 } })).resolves.toBe(0);
    await expect(this.querier.deleteMany(User, { $where: { companyId: null } as any })).resolves.toBe(3);
  }

  async shouldSoftDelete() {
    const id = await this.querier.insertOne(MeasureUnit, { name: 'To be soft deleted' });
    const changes = await this.querier.deleteOneById(MeasureUnit, id);
    expect(changes).toBe(1);

    const found = await this.querier.findOneById(MeasureUnit, id);
    expect(found).toBeUndefined();

    const foundWithSoftDeleted = await this.querier.findOneById(MeasureUnit, id, {
      $where: { deletedAt: { $ne: null } } as any,
    });
    expect(foundWithSoftDeleted).toBeDefined();
    expect(foundWithSoftDeleted!.name).toBe('To be soft deleted');
  }

  async shouldFindManyStream() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
      { name: 'Charlie', email: 'charlie@test.com' },
    ]);

    const collected: User[] = [];
    for await (const row of this.querier.findManyStream(User, {})) {
      collected.push(row);
    }

    expect(collected).toHaveLength(3);
    expect(collected.map((u) => u.name).sort()).toEqual(['Alice', 'Bob', 'Charlie']);
  }

  async shouldFindManyStreamWithFilter() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
      { name: 'Charlie', email: 'charlie@test.com' },
    ]);

    const collected: User[] = [];
    for await (const row of this.querier.findManyStream(User, {
      $where: { name: 'Bob' },
    })) {
      collected.push(row);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0].name).toBe('Bob');
  }

  async shouldFindManyStreamEmpty() {
    const collected: User[] = [];
    for await (const row of this.querier.findManyStream(User, {})) {
      collected.push(row);
    }
    expect(collected).toHaveLength(0);
  }

  async shouldAggregate() {
    await this.querier.insertMany(User, [
      { name: 'Alice', createdAt: 100 },
      { name: 'Bob', createdAt: 200 },
      { name: 'Charlie', createdAt: 300 },
    ]);

    const res = await this.querier.aggregate(User, {
      $where: { createdAt: { $gte: 200 } },
      $agg: { total: { $sum: 'createdAt' } },
    });

    expect(res).toHaveLength(1);
    // MongoDB returns _id: null, while SQL dialects might return it differently depending on group by.
    // We are mainly checking that the task was executed.
    expect(res[0]).toHaveProperty('total');
    // Not `Number(res[0].total)`: Postgres widens a SUM over BIGINT to NUMERIC and hands it back as
    // text, so coercing here is the test agreeing to whatever the driver did instead of checking.
    expect(res[0].total).toBe(500);
  }

  async shouldSoftDeleteExcludeFromReadsAndRestore() {
    const id = await this.querier.insertOne(MeasureUnit, { name: 'unit' });

    // soft-delete stamps the row instead of removing it
    expect(await this.querier.deleteOneById(MeasureUnit, id)).toBe(1);

    // excluded from normal reads, included via withDeleted()
    expect(await this.querier.findOneById(MeasureUnit, id)).toBeUndefined();
    expect(await this.querier.findOneById(MeasureUnit, id, {}, withDeleted())).toMatchObject({ id, name: 'unit' });

    // restore brings it back
    expect(await this.querier.restoreOneById(MeasureUnit, id)).toBe(1);
    expect(await this.querier.findOneById(MeasureUnit, id)).toMatchObject({ id, name: 'unit' });
  }

  async shouldListOnlyTrashed() {
    const [liveId, deadId] = await this.querier.insertMany(MeasureUnit, [{ name: 'live' }, { name: 'dead' }]);
    await this.querier.deleteOneById(MeasureUnit, deadId);

    // "only trashed" is a plain, serializable query - constraining the soft-delete field makes the
    // default `deletedAt IS NULL` filter step aside (no helper, no bypass needed).
    const trashedIds = (await this.querier.findMany(MeasureUnit, { $where: { deletedAt: { $ne: null } } })).map((it) =>
      String(it.id),
    ); // stringify so ObjectId/number ids compare by value
    expect(trashedIds).toContain(String(deadId));
    expect(trashedIds).not.toContain(String(liveId));

    // the live row is still readable normally
    expect(await this.querier.findOneById(MeasureUnit, liveId)).toMatchObject({ id: liveId, name: 'live' });
  }

  async shouldHardDeletePermanently() {
    const id = await this.querier.insertOne(MeasureUnit, { name: 'gone' });
    expect(await this.querier.deleteOneById(MeasureUnit, id, { hardDelete: true })).toBe(1);
    // not recoverable - the row is physically removed
    expect(await this.querier.findOneById(MeasureUnit, id, {}, withDeleted())).toBeUndefined();
  }

  async clearTables() {
    const entities = getEntities();
    await Promise.all(entities.map((entity) => this.querier.deleteMany(entity as Type<object>, {})));
  }

  abstract createTables(): Promise<void>;

  abstract dropTables(): Promise<void>;

  /**
   * Against real data: a category whose only matching unit is trashed must not match, and the count
   * must skip it. Runs on every driver - relation subqueries are emulated with `$lookup` on MongoDB.
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
    expect(byLive.map(({ id }) => String(id))).toEqual([String(categoryId)]);

    const bySize = await this.querier.findMany(MeasureUnitCategory, {
      $select: { id: true },
      $where: { measureUnits: { $size: 1 } },
    });
    expect(bySize.map(({ id }) => String(id))).toEqual([String(categoryId)]);

    expect(await this.querier.findOneById(MeasureUnit, liveId)).toMatchObject({ name: 'kg' });
  }
}
