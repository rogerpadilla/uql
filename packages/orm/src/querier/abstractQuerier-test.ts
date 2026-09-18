import { expect } from 'vitest';
import { getEntities } from '../entity/index.js';
import {
  assertDefined,
  Company,
  type CompanyKind,
  InventoryAdjustment,
  Item,
  ItemAdjustment,
  MeasureUnit,
  MeasureUnitCategory,
  Profile,
  type Spec,
  Tag,
  Tax,
  TaxCategory,
  User,
} from '../test/index.js';
import type { Querier, QuerierPool, QuerySearch, QueryWhere } from '../type/index.js';
import { raw, withDeleted } from '../util/index.js';
import { queryErrorKind } from './queryError.js';

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
      throw new TypeError('boom');
    })().then(
      () => undefined,
      (err: Error) => err.message,
    );

    expect(failed).toBe('boom');
    expect(releases).toBe(1);
  }

  /**
   * Releasing with a transaction open rolls it back and hands the connection over, rather than throwing
   * and losing both the caller's error and the connection.
   */
  async shouldRollBackAnOpenTransactionOnRelease() {
    const querier = await this.pool.getQuerier();
    await querier.beginTransaction();
    await querier.insertOne(User, { name: 'Rolled Back', email: 'rolledback@example.com' });

    await expect(querier.release()).resolves.toBeUndefined();
    expect(querier.hasOpenTransaction).toBe(false);

    // The write is gone, and the next unit of work is not sitting on someone else's transaction.
    await expect(this.pool.count(User, { $where: { email: 'rolledback@example.com' } })).resolves.toBe(0);
  }

  /** The same, through `await using`: the real error must reach the caller unwrapped. */
  async shouldRollBackAnOpenTransactionOnAsyncDispose() {
    const failed = await (async () => {
      await using querier = await this.pool.getQuerier();
      await querier.beginTransaction();
      await querier.insertOne(User, { name: 'Disposed', email: 'disposed@example.com' });
      throw new TypeError('the real failure');
    })().then(
      () => undefined,
      // A throwing dispose would arrive as a SuppressedError instead, hiding this behind an empty message.
      (err: Error) => err.message,
    );

    expect(failed).toBe('the real failure');
    await expect(this.pool.count(User, { $where: { email: 'disposed@example.com' } })).resolves.toBe(0);
  }

  /**
   * Every backend refuses, not just the pooled ones: a pooled querier that kept working took a second
   * connection nothing would give back, and whether a released querier still works should not depend on
   * which database you picked.
   */
  async shouldRefuseToWorkAfterBeingReleased() {
    const querier = await this.pool.getQuerier();
    await querier.release();

    await expect(querier.count(User)).rejects.toThrow('querier already released');
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

    const names: (string | null | undefined)[] = [];
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

  /** The driver's own error, read as it reaches the caller, on every backend MongoDB included. */
  async shouldNameAUniqueViolation() {
    const id = await this.querier.insertOne(User, { name: 'first' });
    const err = await this.querier.insertOne(User, { id, name: 'second' }).catch((thrown: unknown) => thrown);
    expect(queryErrorKind(err)).toBe('uniqueViolation');
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

    for (const id of [first, second]) {
      const found = await this.querier.findOneById(InventoryAdjustment, id, {
        $populate: { itemAdjustments: { $select: { buyPrice: true } } },
      });
      expect(found?.itemAdjustments?.map(({ buyPrice }) => buyPrice).sort()).toEqual([7, 9]);
    }
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

    expect(id).toBeDefined();

    const foundItem = await this.querier.findOneById(Item, id, {
      $select: { id: true, name: true, createdAt: true },
      $populate: { tags: { $select: { name: true, createdAt: true } } },
    });

    expect(foundItem).toMatchObject({
      id,
      ...payload,
    });

    const foundTags = await this.querier.findMany(Tag, {
      $select: { name: true, createdAt: true },
      $populate: { items: { $select: { id: true, name: true, createdAt: true } } },
    });

    const item = { id, name: payload.name, createdAt: payload.createdAt };
    expect(foundTags).toMatchObject(tags.map((tag) => ({ ...tag, items: [item] })));
  }

  /** A narrowed query keeps its projection while populating, which on MongoDB means the aggregation path. */
  async shouldNarrowTheProjectionWhilePopulatingAJoinedRelation() {
    const measureUnitId = await this.querier.insertOne(MeasureUnit, { name: 'unit one' });
    const id = await this.querier.insertOne(Item, { name: 'item one', salePrice: 5, measureUnitId });

    const found = await this.querier.findOneById(Item, id, {
      $exclude: { salePrice: true },
      $populate: { measureUnit: { $select: { name: true } } },
    });

    expect(found).toMatchObject({ id, name: 'item one', measureUnit: { name: 'unit one' } });
    expect(found).not.toHaveProperty('salePrice');
    // the relation's own projection narrows too, inside the join
    expect(found?.measureUnit).not.toHaveProperty('categoryId');
  }

  /** A joined document keeps its own key on every engine, exactly as the parent's does. */
  async shouldKeepAJoinedRelationsIdDespite$exclude() {
    const measureUnitId = await this.querier.insertOne(MeasureUnit, { name: 'unit one' });
    const id = await this.querier.insertOne(Item, { name: 'item one', measureUnitId });

    const found = await this.querier.findOneById(Item, id, {
      $populate: { measureUnit: { $exclude: { id: true } } },
    });

    expect(found?.measureUnit).toMatchObject({ id: measureUnitId, name: 'unit one' });
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
      $populate: { tags: true },
    });

    expect(found).toMatchObject({
      id,
      ...payload,
    });
  }

  /**
   * Updating a 1-1 replaces the child rather than leaving the old row behind. `saveRelation` threads
   * `isUpdate`, but only the to-many branch read it, so the update inserted a second row and a
   * `$populate` then had two to choose from.
   */
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
    expect(found?.kind).toMatchObject({ public: 1, tags: ['kept', 'appended'] });
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
    expect(found?.kind).toMatchObject({ public: 1, country: 'US' });
    expect(found?.kind).not.toHaveProperty('private');
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

  /** A `$pull` leaves a key holding no array as it is, as an older writer may have left it. */
  async shouldPullFromANonArrayJsonKeyAsNoop() {
    const scalar: CompanyKind = { public: 1 };
    const object: CompanyKind = { public: 1 };
    Reflect.set(scalar, 'tags', 'a');
    Reflect.set(object, 'tags', { k: 'a' });
    await this.querier.insertMany(Company, [
      { name: 'JSON Pull Scalar', kind: scalar },
      { name: 'JSON Pull Object', kind: object },
      { name: 'JSON Pull Array', kind: { public: 1, tags: ['a', 'b'] } },
    ]);

    await this.querier.updateMany(
      Company,
      { $where: { name: { $startsWith: 'JSON Pull ' } } },
      { kind: { $pull: { tags: 'a' } } },
    );

    const found = await this.querier.findMany(Company, {
      $select: { name: true, kind: true },
      $where: { name: { $startsWith: 'JSON Pull ' } },
      $sort: { name: 1 },
    });
    expect(found.map(({ name, kind }) => [name, kind])).toEqual([
      ['JSON Pull Array', { public: 1, tags: ['b'] }],
      ['JSON Pull Object', { public: 1, tags: { k: 'a' } }],
      ['JSON Pull Scalar', { public: 1, tags: 'a' }],
    ]);
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

  /** Filtering and sorting by a JSON dot-path, which MySQL reads through a full JSON path (`'$.public'`). */
  async shouldFindAndSortByJsonDotPath() {
    await this.querier.insertOne(Company, { name: 'JSON Scalar One', kind: { public: 1 } });
    await this.querier.insertOne(Company, { name: 'JSON Scalar Zero', kind: { public: 0 } });

    const founds = await this.querier.findMany(Company, { $where: { 'kind.public': 1 } });
    expect(founds.map(({ name }) => name)).toEqual(['JSON Scalar One']);

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
   * Ordering parents by how many rows a to-many holds - "the categories with the most units". A
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
   * them - so ranking by one is refused rather than answered all-equal, on every backend.
   */
  async shouldRejectSortingByARelationCountWithDistinct() {
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
   * takes. Read only where a query names it, and narrowed by the target's own filters, so a
   * soft-deleted row is as invisible here as it is to `$count`.
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

    // A field, so it filters and orders like one - by the expression, which no read has to have selected.
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
   * aggregate's own `$where`. A group no row of an aggregate reaches answers null, as SQL does.
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

    // A row pointing nowhere is in no group of the path, and its own foreign key groups it under null.
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

  /** Needing no id, a tally composes with a raw projection too. */
  async shouldCountBesideARawSelect() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'raw category' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'one', categoryId },
      { name: 'two', categoryId },
    ]);

    const found = await this.querier.findMany(MeasureUnitCategory, {
      $select: [raw`name`],
      $count: { measureUnits: true },
    });

    expect(found).toEqual([{ name: 'raw category', _count: { measureUnits: 2 } }]);
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

  /** A to-many streams with each row: read with the row itself. */
  async shouldStreamAToManyRelation() {
    const categoryId = await this.querier.insertOne(MeasureUnitCategory, { name: 'streamed category' });
    await this.querier.insertMany(MeasureUnit, [
      { name: 'b', categoryId },
      { name: 'a', categoryId },
    ]);

    const streamed: MeasureUnitCategory[] = [];
    for await (const row of this.querier.findManyStream(MeasureUnitCategory, {
      $select: { name: true },
      $where: { id: categoryId },
      $populate: { measureUnits: { $select: { name: true }, $sort: { name: 1 } } },
    })) {
      streamed.push(row);
    }

    expect(streamed).toMatchObject([{ name: 'streamed category', measureUnits: [{ name: 'a' }, { name: 'b' }] }]);
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

    const streamed: unknown[] = [];
    for await (const row of this.querier.findManyStream(MeasureUnitCategory, {
      $select: { name: true },
      $where: { id: categoryId },
      $count: { measureUnits: true },
    })) {
      streamed.push(row);
    }

    expect(streamed).toMatchObject([{ name: 'streamed count', _count: { measureUnits: 2 } }]);
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
   * express it - it orders parents, and a parent has many children.
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

  /**
   * `$distinct` collapses rows that agree on every projected column - the set a SQL dialect names
   * after `SELECT DISTINCT`. MongoDB dropped the clause outright and returned the duplicates, so
   * this is shared rather than per-backend: the whole point of the clause is the same answer anywhere.
   */
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
   * engine but MySQL takes `LIMIT` on an UPDATE or a DELETE, and MongoDB takes neither. MongoDB
   * resolved ids from `$where` alone and dropped the page, so a write meant for one row hit every
   * match - a shared expectation is what keeps the two backends answering the same way.
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
   * Ordering by a related field with no `$populate`: each backend brings the relation in itself (a join
   * on SQL, a `$lookup` unset again on MongoDB), so the rows come back ordered and unwidened.
   */
  async shouldFindManySortedByAnUnpopulatedRelationField() {
    const [zulu, alpha] = await Promise.all([
      this.querier.insertOne(Tax, { name: 'Zulu tax', percentage: 1 }),
      this.querier.insertOne(Tax, { name: 'Alpha tax', percentage: 2 }),
    ]);
    await this.querier.insertMany(Item, [
      { name: 'by zulu', taxId: zulu },
      { name: 'by alpha', taxId: alpha },
    ]);

    const founds = await this.querier.findMany(Item, {
      $select: { name: true },
      $where: { name: { $startsWith: 'by ' } },
      $sort: { tax: { name: 1 } },
    });

    expect(founds.map(({ name }) => name)).toEqual(['by alpha', 'by zulu']);
    // The ordering brought the relation in; it must not have widened the row it returns - which the
    // row's own type now says too, so the key is tested by name rather than read.
    expect(founds.every((found) => !('tax' in found))).toBe(true);
  }

  /**
   * Ordering by a field of a populated to-one, under the column the related entity names: through its
   * join on SQL, through the document its `$lookup` unwound on MongoDB.
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
   * Boolean and numeric operands against a JSON dot-path compare as their own type, where a text
   * extraction raises `text = boolean` on typed drivers and matches nothing on MySQL.
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

  /** A fractional operand against a JSON number compares as a fraction, on a path and inside `$elemMatch`. */
  async shouldFindByJsonDotPathFraction() {
    await this.querier.insertOne(Company, { name: 'JSON Rated Low', kind: { rating: 1.4, items: [{ count: 1.4 }] } });
    await this.querier.insertOne(Company, { name: 'JSON Rated High', kind: { rating: 2.6, items: [{ count: 2.6 }] } });

    const byGt = await this.querier.findMany(Company, { $where: { 'kind.rating': { $gt: 1.2 } } });
    expect(byGt).toHaveLength(2);

    const byLt = await this.querier.findMany(Company, { $where: { 'kind.rating': { $lt: 1.5 } } });
    expect(byLt.map(({ name }) => name)).toEqual(['JSON Rated Low']);

    const byEq = await this.querier.findMany(Company, { $where: { 'kind.rating': 1.4 } });
    expect(byEq.map(({ name }) => name)).toEqual(['JSON Rated Low']);

    const byIn = await this.querier.findMany(Company, { $where: { 'kind.rating': { $in: [2.6] } } });
    expect(byIn.map(({ name }) => name)).toEqual(['JSON Rated High']);

    const byBetween = await this.querier.findMany(Company, { $where: { 'kind.rating': { $between: [1.3, 1.5] } } });
    expect(byBetween.map(({ name }) => name)).toEqual(['JSON Rated Low']);

    const byElem = await this.querier.findMany(Company, {
      $where: { 'kind.items': { $elemMatch: { count: { $gt: 1.5 } } } },
    });
    expect(byElem.map(({ name }) => name)).toEqual(['JSON Rated High']);

    const byNot = await this.querier.findMany(Company, { $where: { 'kind.rating': { $not: { $gt: 2 } } } });
    expect(byNot.map(({ name }) => name)).toEqual(['JSON Rated Low']);
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

    const byAll = await this.querier.findMany(Company, { $where: { 'kind.items': { $all: [{ name: 'first' }] } } });
    expect(byAll.map(({ name }) => name)).toEqual(['JSON Contained']);

    const byNested = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $all: [{ tag: { key: 'a' } }] } },
    });
    expect(byNested.map(({ name }) => name)).toEqual(['JSON Contained']);

    const byNestedArray = await this.querier.findMany(Company, { $where: { 'kind.meta.grid': { $all: [[2, 1]] } } });
    expect(byNestedArray.map(({ name }) => name)).toEqual(['JSON Contained']);

    const byElem = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { tag: { key: 'a' } } } },
    });
    expect(byElem.map(({ name }) => name)).toEqual(['JSON Contained']);

    const byElemArray = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { labels: ['y'] } } },
    });
    expect(byElemArray.map(({ name }) => name)).toEqual(['JSON Contained']);

    const byElemBesideOperator = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { tag: { key: 'a' }, labels: ['y'], n: { $gt: 1 } } } },
    });
    expect(byElemBesideOperator.map(({ name }) => name)).toEqual(['JSON Contained']);

    const byNestedOperator = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { tag: { key: { $in: ['a', 'c'] } } } } },
    });
    expect(byNestedOperator.map(({ name }) => name)).toEqual(['JSON Contained']);
  }

  /** A path holding a scalar or an object has no elements: no array operator matches it, and none fails the read. */
  async shouldMatchNoArrayOperatorOnANonArrayPath() {
    await this.querier.insertMany(Company, [
      { name: 'JSON List Scalar', kind: { meta: { list: 5 } } },
      { name: 'JSON List Object', kind: { meta: { list: { k: 5 } } } },
      { name: 'JSON List Array', kind: { meta: { list: [5], none: [] } } },
    ]);

    const bySize = await this.querier.findMany(Company, { $where: { 'kind.meta.list': { $size: 1 } } });
    expect(bySize.map(({ name }) => name)).toEqual(['JSON List Array']);

    const byBounds = await this.querier.findMany(Company, {
      $where: {
        'kind.meta.list': { $size: { $lte: 2 }, $elemMatch: { $eq: 5 } },
        'kind.meta.none': { $size: { $lt: 1 } },
      },
    });
    expect(byBounds.map(({ name }) => name)).toEqual(['JSON List Array']);

    const byElem = await this.querier.findMany(Company, { $where: { 'kind.meta.list': { $elemMatch: { $gt: 1 } } } });
    expect(byElem.map(({ name }) => name)).toEqual(['JSON List Array']);

    const byElemEq = await this.querier.findMany(Company, { $where: { 'kind.meta.list': { $elemMatch: { $eq: 5 } } } });
    expect(byElemEq.map(({ name }) => name)).toEqual(['JSON List Array']);

    const byElemIn = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { $in: [5, 6] } } },
    });
    expect(byElemIn.map(({ name }) => name)).toEqual(['JSON List Array']);
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

    const byNumber = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { $eq: 1 } } },
    });
    expect(byNumber.map(({ name }) => name)).toEqual(['JSON Mixed Nine']);

    const byText = await this.querier.findMany(Company, {
      $where: { 'kind.meta.list': { $elemMatch: { $in: ['1', 'x'] } } },
    });
    expect(byText.map(({ name }) => name)).toEqual(['JSON Mixed Ten']);

    const byBoolean = await this.querier.findMany(Company, { $where: { 'kind.meta.list': { $all: [true] } } });
    expect(byBoolean.map(({ name }) => name)).toEqual(['JSON Mixed Text']);
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
   * `$elemMatch` edge shapes: plain equality keeps a number's cast and turns `null` into `IS NULL`, an
   * empty match is valid SQL, and an operator applies to a scalar element.
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
   * `$size`/`$all`/`$elemMatch` on a JSON dot-path, on every engine: MariaDB takes no `col->'key'`, and
   * SQLite's `$all` matches a string element.
   */
  async shouldFindByJsonDotPathArrayOperators() {
    await this.querier.insertOne(Company, { name: 'JSON Path Two', kind: { tags: ['a', 'b'], ranks: [1, 2] } });
    await this.querier.insertOne(Company, { name: 'JSON Path One', kind: { tags: ['c'], ranks: [3] } });

    const bySize = await this.querier.findMany(Company, { $where: { 'kind.tags': { $size: 2 } } });
    expect(bySize.map(({ name }) => name)).toEqual(['JSON Path Two']);

    const byAll = await this.querier.findMany(Company, { $where: { 'kind.tags': { $all: ['b', 'a'] } } });
    expect(byAll.map(({ name }) => name)).toEqual(['JSON Path Two']);

    const byMissing = await this.querier.findMany(Company, { $where: { 'kind.tags': { $all: ['absent'] } } });
    expect(byMissing).toEqual([]);

    const byElem = await this.querier.findMany(Company, { $where: { 'kind.tags': { $elemMatch: { $eq: 'b' } } } });
    expect(byElem.map(({ name }) => name)).toEqual(['JSON Path Two']);

    const byElemIn = await this.querier.findMany(Company, {
      $where: { 'kind.tags': { $elemMatch: { $in: ['c', 'z'] } } },
    });
    expect(byElemIn.map(({ name }) => name)).toEqual(['JSON Path One']);

    const byRank = await this.querier.findMany(Company, { $where: { 'kind.ranks': { $elemMatch: { $eq: 2 } } } });
    expect(byRank.map(({ name }) => name)).toEqual(['JSON Path Two']);

    const byRankIn = await this.querier.findMany(Company, {
      $where: { 'kind.ranks': { $elemMatch: { $in: [3, 9] } } },
    });
    expect(byRankIn.map(({ name }) => name)).toEqual(['JSON Path One']);
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
    expect(found?.kind).toBeInstanceOf(Object);
    expect(found?.kind?.isArchived).toBe(true);

    await this.querier.updateOneById(Company, id, {
      kind: { $set: { isArchived: false } },
    });
    found = await this.querier.findOneById(Company, id, { $select: { kind: true } });
    expect(found?.kind).toMatchObject({ isArchived: false });
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
    expect(insertResult.id).toBe(pk);
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
    expect(updateResult.id).toBe(pk);
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

  /**
   * A batch whose rows carry different columns: the `SET` list comes from the whole batch, so a first row
   * carrying only the conflict column does not turn the statement into `DO NOTHING`.
   */
  async shouldUpsertManyWithHeterogeneousFieldSets() {
    const pk1 = '507f1f77bcf86cd799439031';
    const pk2 = '507f1f77bcf86cd799439032';

    await this.querier.upsertMany(TaxCategory, { pk: true }, [
      { pk: pk1, name: 'Het A' },
      { pk: pk2, name: 'Het B' },
    ]);

    await this.querier.upsertMany(TaxCategory, { pk: true }, [{ pk: pk1 }, { pk: pk2, name: 'Het B updated' }]);

    const found1 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk1 } });
    const found2 = await this.querier.findOne(TaxCategory, { $select: { name: true }, $where: { pk: pk2 } });
    expect(found1).toMatchObject({ name: 'Het A' });
    expect(found2).toMatchObject({ name: 'Het B updated' });
  }

  /** `saveMany` reports its ids in payload order, as `insertMany` does, whatever mix of rows it was given. */
  async shouldSaveManyReportingIdsInPayloadOrder() {
    const [seeded] = await this.querier.insertMany(User, [{ name: 'Save Order Seed', createdAt: 1 }]);

    const ids = await this.querier.saveMany(User, [
      { id: seeded, name: 'Save Order Updated', updatedAt: 2 },
      { name: 'Save Order New', createdAt: 2 },
    ]);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(seeded);
    // Not a type assertion: the same declared `number` key is an `ObjectId` on MongoDB, and a
    // BIGINT some SQL drivers hand back as a string. What is invariant is that it names the row.
    expect(ids[1]).toBeDefined();

    const updated = await this.querier.findOneById(User, ids[0], { $select: { name: true } });
    expect(updated).toMatchObject({ name: 'Save Order Updated' });
    const inserted = await this.querier.findOneById(User, ids[1], { $select: { name: true } });
    expect(inserted).toMatchObject({ name: 'Save Order New' });
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

  /**
   * `$not` negates the AND of its clauses, `$nor` the OR. MongoDB has no root-level `$not` and
   * spells both with its own `$nor`, so this is shared rather than per-backend.
   */
  async shouldFindByRootNegationOperators() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]); // Users A, B and C

    const names = async (where: QueryWhere<User>) =>
      (
        await this.querier.findMany(User, {
          $select: { name: true },
          $sort: { name: 1 },
          $where: where,
        })
      ).map(({ name }) => name);

    // NOT (name = A AND email = A's) excludes only A, where the same pair under `$nor` excludes B too.
    await expect(names({ $not: [{ name: 'Some Name A' }, { email: 'someemaila@example.com' }] })).resolves.toEqual([
      'Some Name B',
      'Some Name C',
    ]);
    await expect(names({ $nor: [{ name: 'Some Name A' }, { email: 'someemailb@example.com' }] })).resolves.toEqual([
      'Some Name C',
    ]);

    await expect(names({ $not: [{ name: 'Some Name A' }] })).resolves.toEqual(['Some Name B', 'Some Name C']);

    // Both negations at once, and one alongside an ordinary field.
    await expect(names({ $not: [{ name: 'Some Name A' }], $nor: [{ name: 'Some Name B' }] })).resolves.toEqual([
      'Some Name C',
    ]);
    await expect(names({ email: 'someemailc@example.com', $nor: [{ name: 'Some Name A' }] })).resolves.toEqual([
      'Some Name C',
    ]);

    // Nested inside another group, and negating a clause with its own operator map.
    await expect(names({ $or: [{ $not: [{ name: 'Some Name A' }] }, { name: 'Some Name A' }] })).resolves.toEqual([
      'Some Name A',
      'Some Name B',
      'Some Name C',
    ]);
    await expect(names({ $nor: [{ name: { $in: ['Some Name A', 'Some Name B'] } }] })).resolves.toEqual([
      'Some Name C',
    ]);

    // A negated relation condition still has to emit its join, MongoDB's `$lookup` included.
    const companyId = await this.querier.insertOne(Company, { name: 'Acme' });
    await this.querier.insertOne(User, { name: 'Some Name D', email: 'somemaild@example.com', companyId });

    await expect(names({ $nor: [{ company: { name: 'Acme' } }] })).resolves.toEqual([
      'Some Name A',
      'Some Name B',
      'Some Name C',
    ]);
    await expect(names({ $not: [{ company: { name: 'Acme' } }] })).resolves.toEqual([
      'Some Name A',
      'Some Name B',
      'Some Name C',
    ]);

    // An operator with nothing to negate constrains nothing, the way an empty `$and` does.
    await expect(names({ $nor: [] })).resolves.toEqual(['Some Name A', 'Some Name B', 'Some Name C', 'Some Name D']);
    await expect(names({ $and: [] })).resolves.toEqual(['Some Name A', 'Some Name B', 'Some Name C', 'Some Name D']);
  }

  async shouldCount() {
    await expect(this.querier.count(User, {})).resolves.toBe(0);

    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.count(User, {})).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: null } })).resolves.toBe(3);
    await expect(this.querier.count(User, { $where: { companyId: '1' } })).resolves.toBe(0);
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
    await this.shouldInsertMany(); // 2 Users

    await expect(this.querier.count(User, { $limit: 1 })).resolves.toBe(1);
    await expect(this.querier.count(User, { $limit: 10 })).resolves.toBe(2);

    await expect(this.querier.count(User, { $skip: 1 })).resolves.toBe(1);
    await expect(this.querier.count(User, { $skip: 5 })).resolves.toBe(0);
    await expect(this.querier.count(User, { $skip: 1, $limit: 5 })).resolves.toBe(1);
  }

  /** A capped count: true the moment one row matches, false when none does. */
  async shouldExists() {
    await this.shouldInsertMany(); // 2 Users

    await expect(this.querier.exists(User)).resolves.toBe(true);
    await expect(this.querier.exists(User, { $where: { name: 'Some Name B' } })).resolves.toBe(true);
    await expect(this.querier.exists(User, { $where: { name: 'nobody' } })).resolves.toBe(false);
  }

  /** Nothing inserted, so the same calls answer false rather than throwing on an empty table. */
  async shouldExistsOnAnEmptyTable() {
    await expect(this.querier.exists(User)).resolves.toBe(false);
    await expect(this.querier.exists(User, { $where: { name: 'nobody' } })).resolves.toBe(false);
  }

  /** The `$entity` form takes the same filter and gives the same answer as the two-argument one. */
  async shouldExistsInTheEntityAsFieldForm() {
    await this.shouldInsertMany(); // 2 Users

    await expect(this.querier.exists({ $entity: User, $where: { name: 'Some Name B' } })).resolves.toBe(true);
    await expect(this.querier.exists({ $entity: User, $where: { name: 'nobody' } })).resolves.toBe(false);
  }

  /**
   * `count` takes no `$sort`, but `/http` passes a query on unchecked, so one can arrive, on any backend.
   * The SQL it emits is pinned in `shouldCountDroppingASmuggledSort`.
   */
  async shouldCountIgnoringASmuggledSort() {
    await this.shouldInsertMany(); // 2 Users

    const sorted: QuerySearch<User> = { $sort: { name: -1 }, $skip: 1, $limit: 1 };

    await expect(this.querier.count(User, sorted)).resolves.toBe(1);
    // @ts-expect-error: a count takes no `$sort`
    await expect(this.querier.count(User, { $sort: { name: 1 } })).resolves.toBe(2);
  }

  /**
   * `$limit: 0` asks for no rows on every backend, the same as it has since 0.30.0. MongoDB reads
   * `limit(0)` as *unlimited*, so a read that handed it to the driver answered with the whole
   * collection - the one clause where the two engines mean opposite things by the same value.
   */
  async shouldReadNoRowsOnAZeroLimit() {
    await this.shouldInsertMany(); // 2 Users

    await expect(this.querier.findMany(User, { $limit: 0 })).resolves.toEqual([]);
    await expect(this.querier.count(User, { $limit: 0 })).resolves.toBe(0);
  }

  async shouldUpdateMany() {
    await Promise.all([this.shouldInsertMany(), this.shouldInsertOne()]);

    await expect(this.querier.updateMany(User, { $where: { companyId: '1' } }, { companyId: null })).resolves.toBe(0);
    await expect(this.querier.updateMany(User, { $where: { companyId: null } }, { companyId: '1' })).resolves.toBe(3);
    await expect(this.querier.updateMany(User, { $where: { companyId: '1' } }, { companyId: null })).resolves.toBe(3);
  }

  async shouldThrowIfUnknownComparisonOperator() {
    await expect(
      this.querier.findMany(User, {
        // @ts-expect-error: no such operator
        $where: { name: { $someInvalidOperator: 'some' } },
      }),
    ).rejects.toThrow('unknown operator: $someInvalidOperator');
  }

  async shouldIgnoreRollbackTransactionWithoutBeginTransaction() {
    await expect(this.querier.rollbackTransaction()).resolves.toBeUndefined();
    expect(this.querier.hasOpenTransaction).toBe(false);
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
    await this.querier.rollbackTransaction();
    await this.querier.release();
  }

  async shouldReturnTransactionValue() {
    const affectedRows = await this.querier.transaction(async () => {
      await this.shouldInsertMany();
      const count = await this.querier.count(User, {});
      await this.querier.deleteMany(User, {}, { unfiltered: true });
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
          throw new TypeError('inner error');
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
    const inventoryAdjustment = await this.querier.findOneById(InventoryAdjustment, '-1', {
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

    assertDefined(user);
    assertDefined(company);

    const [firstItemId, secondItemId] = await this.querier.insertMany(Item, [
      {
        name: 'some item name a',
        creatorId: user.id,
        companyId: company.id,
      },
      {
        name: 'some item name b',
        creatorId: user.id,
        companyId: company.id,
      },
    ]);

    const inventoryAdjustmentId = await this.querier.insertOne(InventoryAdjustment, {
      description: 'some inventory adjustment',
      creatorId: user.id,
      companyId: company.id,
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
    await expect(this.querier.deleteMany(User, { $where: { companyId: '1' } })).resolves.toBe(0);
    await expect(this.querier.deleteMany(User, { $where: { companyId: null } })).resolves.toBe(3);
  }

  /**
   * A bulk write names the rows it changes. An empty `$where` addresses every row of the table, which
   * is a thing to ask for by name rather than to reach by leaving a filter off.
   */
  async shouldRefuseABulkWriteThatNamesNoRows() {
    await this.querier.insertMany(User, [
      { name: 'unfiltered one', email: 'unfiltered.one@test.com' },
      { name: 'unfiltered two', email: 'unfiltered.two@test.com' },
    ]);

    await expect(this.querier.deleteMany(User, {})).rejects.toThrow("'deleteMany' over 'User' names no rows");
    await expect(this.querier.deleteMany(User, { $where: {} })).rejects.toThrow('names no rows');
    await expect(this.querier.updateMany(User, {}, { name: 'x' })).rejects.toThrow(
      "'updateMany' over 'User' names no rows",
    );

    // Still there: the refusal happens before any statement runs.
    await expect(this.querier.count(User)).resolves.toBe(2);

    // A `$limit` names them too - it caps how many rows the write reaches.
    await expect(this.querier.updateMany(User, { $limit: 1 }, { name: 'capped' })).resolves.toBe(1);

    const changed = await this.querier.updateMany(User, {}, { name: 'renamed' }, { unfiltered: true });
    expect(changed).toBe(2);
    const removed = await this.querier.deleteMany(User, {}, { unfiltered: true });
    expect(removed).toBe(2);
  }

  async shouldSoftDelete() {
    const id = await this.querier.insertOne(MeasureUnit, { name: 'To be soft deleted' });
    const changes = await this.querier.deleteOneById(MeasureUnit, id);
    expect(changes).toBe(1);

    const found = await this.querier.findOneById(MeasureUnit, id);
    expect(found).toBeUndefined();

    const foundWithSoftDeleted = await this.querier.findOneById(MeasureUnit, id, {
      $where: { deletedAt: { $ne: null } },
    });
    expect(foundWithSoftDeleted).toBeDefined();
    expect(foundWithSoftDeleted?.name).toBe('To be soft deleted');
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
    expect(page).toHaveLength(1);
    expect(page[0].name).toBe('Bob');
    expect(Object.keys(page[0])).not.toContain('_uql_total');
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

    const [rows, total] = await this.querier.findManyAndCount(User, { $select: { name: true }, $distinct: true });

    expect(rows).toHaveLength(2);
    expect(total).toBe(2);
  }

  /** The filter bounds the deduplicated total as well, and a page never shrinks it. */
  async shouldFindManyAndCountDistinctRowsOfAPage() {
    await this.querier.insertMany(User, [
      { name: 'a', email: 'dp1@test.com', companyId: '1' },
      { name: 'a', email: 'dp2@test.com', companyId: '1' },
      { name: 'b', email: 'dp3@test.com', companyId: '1' },
      { name: 'c', email: 'dp4@test.com', companyId: '2' },
    ]);

    const [rows, total] = await this.querier.findManyAndCount(User, {
      $select: { name: true },
      $where: { companyId: '1' },
      $distinct: true,
      $limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(total).toBe(2);
  }

  /** Nothing matched, so the page is empty and so is the total - not the count of every row. */
  async shouldFindManyAndCountMatchingNothing() {
    await this.querier.insertMany(User, [{ name: 'Alice', email: 'alice@test.com' }]);

    await expect(this.querier.findManyAndCount(User, { $where: { name: 'nobody' } })).resolves.toEqual([[], 0]);
  }

  /** The filter still bounds the total when a page is taken out of it. */
  async shouldFindManyAndCountAFilteredPage() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com', companyId: '1' },
      { name: 'Bob', email: 'bob@test.com', companyId: '1' },
      { name: 'Charlie', email: 'charlie@test.com', companyId: '2' },
    ]);

    const [page, total] = await this.querier.findManyAndCount(User, {
      $where: { companyId: '1' },
      $sort: { name: 1 },
      $limit: 1,
    });

    expect(total).toBe(2);
    expect(page.map((it) => it.name)).toEqual(['Alice']);
  }

  /**
   * A `$required` relation drops parents with no match, and the total counts what is left rather than
   * what the filter alone matched - a page of one out of one, not out of three the read can never
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

  async shouldFindManyStreamInsideATransaction() {
    await this.querier.beginTransaction();
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    const collected: User[] = [];
    for await (const row of this.querier.findManyStream(User, { $sort: { name: 1 } })) {
      collected.push(row);
    }

    expect(collected.map((it) => it.name)).toEqual(['Alice', 'Bob']);
    // The stream must leave the caller's transaction open, and its own rows visible to it.
    expect(this.querier.hasOpenTransaction).toBe(true);
    expect(await this.querier.count(User, {})).toBe(2);
    await this.querier.commitTransaction();
  }

  async shouldReleaseTheStreamWhenTheCallerStopsEarly() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
      { name: 'Charlie', email: 'charlie@test.com' },
    ]);

    for await (const row of this.querier.findManyStream(User, { $sort: { name: 1 } })) {
      expect(row.name).toBe('Alice');
      break;
    }

    // An abandoned cursor holds its connection, so what proves the cleanup is the next statement.
    expect(await this.querier.count(User, {})).toBe(3);
  }

  async shouldStreamTwiceOverOneQuerier() {
    await this.querier.insertMany(User, [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ]);

    const first: User[] = [];
    for await (const row of this.querier.findManyStream(User, { $sort: { name: 1 } })) {
      first.push(row);
    }
    const second: User[] = [];
    for await (const row of this.querier.findManyStream(User, { $sort: { name: -1 } })) {
      second.push(row);
    }

    expect(first.map((it) => it.name)).toEqual(['Alice', 'Bob']);
    expect(second.map((it) => it.name)).toEqual(['Bob', 'Alice']);
  }

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

    // Exact, never coerced: Postgres widens a SUM over BIGINT to NUMERIC and hands it back as text, and
    // MongoDB's `$group` answers with an `_id` the row does not declare.
    expect(res).toEqual([{ total: 500 }]);
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

    expect(unit).toMatchObject({ name: 'unit' });
    expect(unit).not.toHaveProperty('category');
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
    await Promise.all(entities.map((entity) => this.querier.deleteMany(entity, {}, { unfiltered: true })));
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
