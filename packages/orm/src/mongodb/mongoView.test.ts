import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { defineEntity, defineView, f } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { mongoUri, provisioningTimeout } from '../test/index.js';
import { MongodbQuerierPool } from './mongodbQuerierPool.js';

const objectId = () => new ObjectId().toHexString();

const Owner = defineEntity({ name: 'MongoViewOwner', fields: { id: f.string().id().onInsert(objectId) } });

const Item = defineEntity({
  name: 'MongoViewItem',
  fields: {
    id: f.string().id().onInsert(objectId),
    ownerId: f.string(),
    vec: f.vector(2),
    groupId: f.number(),
    kind: f.string(),
    published: f.boolean(),
    deletedAt: f.date().nullable().softDelete(),
  },
}).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (item) => item.ownerId }) }));

const Totals = defineView({
  name: 'MongoViewTotals',
  from: () => Item,
  aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
});

const Kinds = defineView({
  name: 'MongoViewKinds',
  from: () => Item,
  aggregate: { $group: { groupId: true, kind: true }, $select: { total: { $count: '*' } } },
});

const Published = defineView({
  name: 'MongoViewPublished',
  from: () => Item,
  find: { $select: { id: true, ownerId: true, vec: true, groupId: true }, $where: { published: true } },
});

const Stored = defineView({
  name: 'MongoViewStored',
  from: () => Item,
  aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
  materialized: true,
});

const OwnerTotals = defineView({
  name: 'MongoViewOwnerTotals',
  from: () => Item,
  aggregate: { $group: { ownerId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
  materialized: true,
}).relations((rel) => ({ owner: () => rel.manyToOne(Owner, { references: (row) => row.ownerId }) }));

const Busy = defineView({ name: 'MongoViewBusy', from: () => Totals, find: { $where: { total: { $gt: 1 } } } });

const Pin = defineEntity({
  name: 'MongoViewPin',
  fields: { id: f.string().id().onInsert(objectId), publishedId: f.string() },
}).relations((rel) => ({
  published: () => rel.manyToOne(Published, { references: (pin) => pin.publishedId }),
}));

/** A plain view on MongoDB: read as its source's pipeline, joined by a lookup through it. */
const pool = new MongodbQuerierPool(mongoUri('uql_view'));
let ownerId = '';
let ids: string[] = [];

beforeAll(async () => {
  await pool.withQuerier((querier) => querier.db.dropDatabase());
  await new Migrator(pool, { entities: [Owner, Item, Pin, Totals, Kinds, Published, Busy, Stored, OwnerTotals] }).sync({
    logging: false,
  });
  ownerId = await pool.insertOne(Owner, {});
  const item = { ownerId, vec: [1, 0], kind: 'a', published: true };
  ids = await pool.insertMany(Item, [
    { ...item, groupId: 1 },
    { ...item, groupId: 1, kind: 'b', vec: [0, 1] },
    { ...item, groupId: 2 },
    { ...item, groupId: 2, published: false },
    { ...item, groupId: 3, deletedAt: new Date() },
  ]);
  await pool.insertOne(Pin, { publishedId: ids[2]! });
}, provisioningTimeout);

afterAll(async () => {
  await pool.withQuerier((querier) => querier.db.dropDatabase());
  await pool.end();
});

it("should read an aggregate view as its query, its source's filters held inside it", async () => {
  expect(await pool.findMany(Totals, { $sort: { groupId: 'asc' } })).toEqual([
    { groupId: 1, total: 2 },
    { groupId: 2, total: 1 },
  ]);
  expect(await pool.findOneById(Totals, 2)).toEqual({ groupId: 2, total: 1 });
  expect(await pool.count(Totals, { $where: { total: { $gt: 1 } } })).toBe(1);
});

it('should read a view keyed by two groups', async () => {
  expect(await pool.findMany(Kinds, { $where: { groupId: 2 } })).toEqual([{ groupId: 2, kind: 'a', total: 2 }]);
});

it('should read a find view, joined and aggregated over', async () => {
  expect(await pool.count(Published)).toBe(3);
  expect(await pool.findOneById(Published, ids[0]!, { $select: { id: true, groupId: true } })).toEqual({
    id: ids[0],
    groupId: 1,
  });
  expect(
    await pool.findMany(Pin, { $select: { id: true }, $populate: { published: { $select: { groupId: true } } } }),
  ).toEqual([{ id: expect.any(String), published: { id: ids[2], groupId: 2 } }]);
  expect(await pool.aggregate(Published, { $select: { most: { $max: { groupId: true } } } })).toEqual([{ most: 2 }]);
});

it('should read a key a view column copies as the key it is, and filter by it', async () => {
  expect(
    await pool.findMany(Published, { $select: { id: true, ownerId: true }, $where: { ownerId, groupId: 1 } }),
  ).toEqual([
    { id: ids[0], ownerId },
    { id: ids[1], ownerId },
  ]);
});

it('should rank a view by a vector its rows hold, the distance computed', async () => {
  expect(
    await pool.findMany(Published, { $select: { id: true }, $sort: { vec: { $vector: [0, 1] } }, $limit: 1 }),
  ).toEqual([{ id: ids[1] }]);
});

it('should refuse a $text search of a plain view, which reads an index only a collection has', async () => {
  await expect(pool.findMany(Published, { $where: { $text: { $value: 'a' } } })).rejects.toThrow(
    "'MongoViewPublished' is a plain view: it has no rows of its own to index for a $text search on MongoDB",
  );
});

it('should read a view over a view, and filter by a relation into one', async () => {
  expect(await pool.findMany(Busy, {})).toEqual([{ groupId: 1, total: 2 }]);
  expect(await pool.count(Pin, { $where: { published: { groupId: 2 } } })).toBe(1);
  expect(await pool.count(Pin, { $where: { published: { groupId: 1 } } })).toBe(0);
});

it("should refresh a materialized view with $out, its documents keyed by the view's key", async () => {
  await pool.refreshView(Stored);
  expect(await pool.findMany(Stored, { $sort: { groupId: 'asc' } })).toEqual([
    { groupId: 1, total: 2 },
    { groupId: 2, total: 1 },
  ]);

  await pool.updateOneById(Item, ids[3]!, { published: true });
  await pool.refreshView(Stored);
  expect(await pool.findOneById(Stored, 2)).toEqual({ groupId: 2, total: 2 });
  await pool.updateOneById(Item, ids[3]!, { published: false });
});

it('should populate a relation of a materialized view, read from its documents', async () => {
  await pool.refreshView(OwnerTotals);

  expect(await pool.findMany(OwnerTotals, { $populate: { owner: { $select: { id: true } } } })).toEqual([
    { ownerId, total: 3, owner: { id: ownerId } },
  ]);
});

it('should refuse a refresh inside a transaction, which $out runs outside of', async () => {
  await expect(pool.transaction((querier) => querier.refreshView(Stored))).rejects.toThrow(
    "MongoDB refreshes 'MongoViewStored' with $out, which runs outside a transaction",
  );
});

it('should fill a materialized view the sync creates, over documents already there', async () => {
  const Filled = defineView({
    name: 'MongoViewFilled',
    from: () => Item,
    aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
    materialized: true,
  });
  await new Migrator(pool, { entities: [Item, Filled] }).sync({ logging: false });

  expect(await pool.findMany(Filled, { $sort: { groupId: 'asc' } })).toEqual([
    { groupId: 1, total: 2 },
    { groupId: 2, total: 1 },
  ]);
});

it('should read a view of its top rows', async () => {
  const Top = defineView({
    name: 'MongoViewTop',
    from: () => Item,
    find: { $select: { id: true, groupId: true }, $where: { published: true }, $sort: { groupId: 'desc' }, $limit: 1 },
  });

  expect(await pool.findMany(Top, { $select: { groupId: true } })).toEqual([{ groupId: 2 }]);
});
