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
  await new Migrator(pool, { entities: [Owner, Item, Pin, Totals, Kinds, Published, Busy] }).sync({ logging: false });
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
