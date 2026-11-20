// A view on every SQL engine: read as its query, so the derived table each read renders has to run everywhere.

import { beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../context/context.js';
import { defineEntity, defineView, f } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { sqlPools, syncedPool } from '../test/sqlPools.js';
import { $context } from '../util/contextRefs.js';
import { refs, sql, tableOf } from '../util/sql.js';

const Item = defineEntity({
  name: 'ViewTestItem',
  fields: {
    id: f.number().autoIncrement(),
    groupId: f.number(),
    published: f.boolean(),
    deletedAt: f.date().nullable().softDelete(),
  },
});

const Totals = defineView({
  name: 'ViewTestTotals',
  from: () => Item,
  aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
});

const Published = defineView({
  name: 'ViewTestPublished',
  from: () => Item,
  find: { $select: { id: true, groupId: true }, $where: { published: true } },
}).relations((rel) => ({ bucket: () => rel.manyToOne(Bucket, { references: (item) => item.groupId }) }));

const Tag = defineEntity({ name: 'ViewTestTag', fields: { id: f.number().id(), label: f.string() } });

const Link = defineEntity({
  name: 'ViewTestLink',
  fields: { id: f.number().autoIncrement(), bucketId: f.number(), tagId: f.number(), active: f.boolean() },
});

const LiveLink = defineView({
  name: 'ViewTestLiveLink',
  from: () => Link,
  find: { $select: { bucketId: true, tagId: true }, $where: { active: true } },
}).relations((rel) => ({
  bucket: () => rel.manyToOne(Bucket, { references: (link) => link.bucketId }),
  tag: () => rel.manyToOne(Tag, { references: (link) => link.tagId }),
}));

const Sale = defineEntity({
  name: 'ViewTestSale',
  fields: { id: f.number().autoIncrement(), regionId: f.number(), amount: f.number(), void: f.boolean() },
});

const RegionTotals = defineView({
  name: 'ViewTestRegionTotals',
  from: () => Sale,
  aggregate: {
    $group: { regionId: true },
    $select: { sales: { $count: '*' }, amount: { $sum: { amount: true } } },
    $where: { void: false },
  },
  materialized: true,
});

const BucketTotals = defineView({
  name: 'ViewTestBucketTotals',
  from: () => Item,
  aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
  materialized: true,
}).relations((rel) => ({ bucket: () => rel.manyToOne(Bucket, { references: (row) => row.groupId }) }));

const Top = defineView({
  name: 'ViewTestTop',
  from: () => Item,
  find: { $select: { id: true, groupId: true }, $where: { published: true }, $sort: { groupId: 'desc' }, $limit: 1 },
});

const Score = defineEntity({
  name: 'ViewTestScore',
  fields: { id: f.number().autoIncrement(), playerId: f.number(), points: f.number() },
});

const Leader = defineView({
  name: 'ViewTestLeader',
  from: () => Score,
  aggregate: {
    $group: { playerId: true },
    $select: { points: { $sum: { points: true } } },
    $sort: { points: 'desc' },
    $limit: 1,
  },
  materialized: true,
});

const Visit = defineEntity({
  name: 'ViewTestVisit',
  fields: { id: f.number().autoIncrement(), siteId: f.number().tenant($context.tenantId) },
}).policies([{ allow: {} }]);

const SiteVisits = defineView({
  name: 'ViewTestSiteVisits',
  from: () => Visit,
  aggregate: { $group: { siteId: true }, $select: { visits: { $count: '*' } } },
  materialized: true,
}).policies([{ allow: { siteId: $context.tenantId } }]);

const Bucket = defineEntity({ name: 'ViewTestBucket', fields: { id: f.number().id() } }).relations((rel) => ({
  items: () => rel.oneToMany(Published, { mappedBy: (item) => item.bucket }),
  tags: () => rel.manyToMany(Tag, { through: () => LiveLink }),
}));

const Pin = defineEntity({
  name: 'ViewTestPin',
  fields: { id: f.number().autoIncrement(), publishedId: f.number() },
}).relations((rel) => ({
  published: () => rel.manyToOne(Published, { references: (pin) => pin.publishedId }),
}));

describe.each(sqlPools('test_view'))('a view on %s', (_name, connect) => {
  const pool = syncedPool(connect, [
    Item,
    Pin,
    Tag,
    Link,
    Bucket,
    Totals,
    Published,
    LiveLink,
    Sale,
    RegionTotals,
    BucketTotals,
    Visit,
    SiteVisits,
    Top,
    Score,
    Leader,
  ]);
  let ids: number[] = [];

  beforeAll(async () => {
    ids = await pool().insertMany(Item, [
      { groupId: 1, published: true },
      { groupId: 1, published: true },
      { groupId: 2, published: true },
      { groupId: 2, published: false },
      { groupId: 3, published: true, deletedAt: new Date() },
    ]);
    await pool().insertOne(Pin, { publishedId: ids[2]! });
    await pool().insertMany(Bucket, [{ id: 1 }, { id: 2 }]);
    await pool().insertMany(Tag, [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ]);
    await pool().insertMany(Link, [
      { bucketId: 1, tagId: 1, active: true },
      { bucketId: 1, tagId: 2, active: false },
      { bucketId: 2, tagId: 2, active: true },
    ]);
  });

  it("should read an aggregate view as its query, its source's filters held inside it", async () => {
    expect(await pool().findMany(Totals, { $sort: { groupId: 'asc' } })).toEqual([
      { groupId: 1, total: 2 },
      { groupId: 2, total: 1 },
    ]);
    expect(await pool().findOneById(Totals, 2)).toEqual({ groupId: 2, total: 1 });
    expect(await pool().count(Totals, { $where: { total: { $gt: 1 } } })).toBe(1);
  });

  it('should read a find view, joined and aggregated over', async () => {
    expect(await pool().count(Published)).toBe(3);
    expect(await pool().findMany(Pin, { $select: { id: true }, $populate: { published: true } })).toEqual([
      { id: expect.any(Number), published: { id: ids[2], groupId: 2 } },
    ]);
    expect(await pool().aggregate(Published, { $select: { most: { $max: { groupId: true } } } })).toEqual([
      { most: 2 },
    ]);
  });

  it('should read the rows of a to-many and a many-to-many through a view', async () => {
    expect(
      await pool().findMany(Bucket, {
        $sort: { id: 'asc' },
        $populate: { items: { $select: { groupId: true }, $sort: { id: 'asc' } }, tags: { $select: { label: true } } },
      }),
    ).toEqual([
      { id: 1, items: [{ groupId: 1 }, { groupId: 1 }], tags: [{ label: 'a' }] },
      { id: 2, items: [{ groupId: 2 }], tags: [{ label: 'b' }] },
    ]);
    expect(await pool().count(Bucket, { $where: { tags: { label: 'b' } } })).toBe(1);
  });

  it('should keep a view among the entities but plan no table for it, synced alone', async () => {
    const migrator = new Migrator(pool(), { entities: [Item, Published] });

    expect(migrator.entities).toEqual([Item, Published]);
    expect(migrator.tables).toEqual([Item]);
    expect(await migrator.planSync({ entity: Published, safe: false })).toEqual([]);
  });

  it('should refuse to estimate a plain view, which has no rows of its own', async () => {
    await expect(pool().estimatedCount(Published)).rejects.toThrow(
      "'ViewTestPublished' is a plain view: it has no rows of its own to estimate: count it instead",
    );
  });

  it('should read a view in raw SQL as the read does', async () => {
    const totals = refs(Totals);

    expect(await pool().all(sql`SELECT ${totals.total} FROM ${tableOf(totals)} ORDER BY ${totals.groupId}`)).toEqual([
      { total: 2 },
      { total: 1 },
    ]);
  });

  it("should refresh a materialized view to its query's rows: a new group, a changed one and a gone one", async () => {
    const [first] = await pool().insertMany(Sale, [
      { regionId: 1, amount: 10, void: false },
      { regionId: 1, amount: 5, void: false },
      { regionId: 2, amount: 7, void: false },
    ]);
    await pool().refreshView(RegionTotals);

    expect(await pool().findMany(RegionTotals, { $sort: { regionId: 'asc' } })).toEqual([
      { regionId: 1, sales: 2, amount: 15 },
      { regionId: 2, sales: 1, amount: 7 },
    ]);

    await pool().updateOneById(Sale, first!, { amount: 20 });
    await pool().updateMany(Sale, { $where: { regionId: 2 } }, { void: true });
    await pool().insertOne(Sale, { regionId: 3, amount: 1, void: false });
    await pool().refreshView(RegionTotals);

    expect(await pool().findMany(RegionTotals, { $sort: { regionId: 'asc' } })).toEqual([
      { regionId: 1, sales: 2, amount: 25 },
      { regionId: 3, sales: 1, amount: 1 },
    ]);
  });

  it('should populate a relation of a materialized view, read from its rows', async () => {
    await pool().refreshView(BucketTotals);

    expect(
      await pool().findMany(BucketTotals, {
        $populate: { bucket: { $select: { id: true } } },
        $sort: { groupId: 'asc' },
      }),
    ).toEqual([
      { groupId: 1, total: 2, bucket: { id: 1 } },
      { groupId: 2, total: 1, bucket: { id: 2 } },
    ]);
  });

  it('should read a view of its top rows, and keep a materialized one to them', async () => {
    expect(await pool().findMany(Top, { $select: { groupId: true } })).toEqual([{ groupId: 2 }]);
    await pool().insertMany(Score, [
      { playerId: 1, points: 3 },
      { playerId: 2, points: 4 },
      { playerId: 1, points: 2 },
    ]);
    await pool().refreshView(Leader);

    expect(await pool().findMany(Leader, {})).toEqual([{ playerId: 1, points: 5 }]);
  });

  it('should refresh inside a transaction, landing with the writes that called for it or with none', async () => {
    await expect(
      pool().transaction(async (querier) => {
        await querier.insertOne(Sale, { regionId: 4, amount: 3, void: false });
        await querier.refreshView(RegionTotals);
        expect(await querier.findOneById(RegionTotals, 4)).toEqual({ regionId: 4, sales: 1, amount: 3 });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(await pool().findOneById(RegionTotals, 4)).toBeUndefined();
  });

  it('should refuse to refresh a plain view, which its query reads', async () => {
    // @ts-expect-error only a materialized view is refreshed, which an untyped caller is refused at run time
    await expect(pool().refreshView(Totals)).rejects.toThrow(
      "'ViewTestTotals' is no materialized view: only one is refreshed",
    );
  });

  it("should refresh past its source's policies, its own holding each caller to its rows", async () => {
    await withContext({ tenantId: 1 }, () => pool().insertMany(Visit, [{}, {}]));
    await withContext({ tenantId: 2 }, () => pool().insertOne(Visit, {}));
    await withContext({ tenantId: 1 }, () => pool().refreshView(SiteVisits));

    expect(await withContext({ tenantId: 2 }, () => pool().findMany(SiteVisits, {}))).toEqual([
      { siteId: 2, visits: 1 },
    ]);
    expect(await withContext({ tenantId: 1 }, () => pool().findMany(SiteVisits, {}))).toEqual([
      { siteId: 1, visits: 2 },
    ]);
  });

  it('should fill a materialized view the sync creates, over rows already there', async () => {
    const Filled = defineView({
      name: 'ViewTestFilled',
      from: () => Item,
      aggregate: { $group: { groupId: true }, $select: { total: { $count: '*' } }, $where: { published: true } },
      materialized: true,
    });
    const migrator = new Migrator(pool(), { entities: [Item, Filled] });
    await migrator.sync({ entity: Filled });

    expect(await pool().findMany(Filled, { $sort: { groupId: 'asc' } })).toEqual([
      { groupId: 1, total: 2 },
      { groupId: 2, total: 1 },
    ]);
    await pool().run(sql.text(`DROP TABLE ${pool().dialect.escapeId('ViewTestFilled')}`));
  });
});
