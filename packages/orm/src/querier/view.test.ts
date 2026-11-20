// A view on every SQL engine: read as its query, so the derived table each read renders has to run everywhere.

import { beforeAll, describe, expect, it } from 'vitest';
import { defineEntity, defineView, f } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { sqlPools, syncedPool } from '../test/sqlPools.js';
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
  const pool = syncedPool(connect, [Item, Pin, Tag, Link, Bucket, Totals, Published, LiveLink]);
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
});
