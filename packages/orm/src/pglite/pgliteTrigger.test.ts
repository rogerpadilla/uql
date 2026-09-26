// What only a row-level engine with a BEFORE trigger can do, which the shared suite in
// `migrate/trigger.test.ts` cannot ask of every engine: assigning to the incoming row and reading the
// outgoing one.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, getMeta, Id, Trigger, removeEntity } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { assertDefined } from '../test/index.js';
import { raw } from '../util/raw.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

@Trigger(
  { on: 'beforeInsert', run: (newRow) => raw`${newRow.slug} := lower(${newRow.title});` },
  { on: 'beforeDelete', name: 'guard', run: (_newRow, oldRow) => raw`PERFORM ${oldRow.id};` },
  {
    on: 'beforeUpdate',
    of: (post) => [post.title],
    run: (newRow) => raw`${newRow.slug} := lower(${newRow.title});`,
  },
  {
    on: 'afterDelete',
    name: 'audit',
    run: (_newRow, oldRow) => raw`INSERT INTO "Trash" ("postId") VALUES (${oldRow.id});`,
  },
  {
    on: 'afterInsert',
    name: 'popular',
    where: { $new: { views: { $gt: 100 } } },
    run: (newRow) => raw`INSERT INTO "Trash" ("postId") VALUES (${newRow.id});`,
  },
  // A transition, which `of` alone cannot state: from one value to another.
  {
    on: 'afterUpdate',
    name: 'published',
    where: { $old: { title: 'Draft' }, $new: { title: { $in: ['Published', 'Featured'] } } },
    run: (newRow) => raw`INSERT INTO "Trash" ("postId") VALUES (${newRow.id});`,
  },
  // Every character that could end a literal or the body early: a quote, a LIKE wildcard, a dollar quote.
  {
    on: 'afterInsert',
    name: 'literal',
    where: { $new: { title: "it's 100% $$" } },
    run: (newRow) => raw`INSERT INTO "Trash" ("postId") SELECT ${newRow.id} WHERE ${"$$ it's"} <> '';`,
  },
)
@Entity()
class Post {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) slug?: string | null;
  @Field({ type: Number }) views?: number | null;
}

@Entity()
class Trash {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) postId?: number | null;
}

describe('a trigger on PGlite', () => {
  let pool: PgliteQuerierPool;
  const sync = () => new Migrator(pool, { entities: [Trash, Post] }).sync({ logging: false });

  beforeAll(async () => {
    pool = new PgliteQuerierPool('memory://');
    await sync();
  });

  afterAll(async () => {
    await pool.end();
    removeEntity(Post);
    removeEntity(Trash);
  });

  it('should fire before an insert, filling the column the body assigns', async () => {
    const id = await pool.insertOne(Post, { title: 'Hello World', views: 0 });
    const [post] = await pool.all<{ slug: string }>(`SELECT "slug" FROM "Post" WHERE "id" = ${id}`);
    expect(post.slug).toBe('hello world');
  });

  // `UPDATE OF` alone fires on a column merely assigned; the `IS DISTINCT FROM` beside it is what narrows that.
  it('should not fire when the watched column is assigned the value it already held', async () => {
    const id = await pool.insertOne(Post, { title: 'Fourth', views: 0 });
    await pool.run(`UPDATE "Post" SET "slug" = 'kept' WHERE "id" = ${id}`);
    await pool.updateOneById(Post, id, { title: 'Fourth' });
    const [post] = await pool.all<{ slug: string }>(`SELECT "slug" FROM "Post" WHERE "id" = ${id}`);
    expect(post.slug).toBe('kept');
  });

  // A dropped trigger leaves the function it called, which would pile up with every edited body.
  it('should leave no function behind a trigger it replaced', async () => {
    const meta = getMeta(Post);
    const declared = meta.triggers;
    assertDefined(declared);
    meta.triggers = declared.map((trigger) => ({ ...trigger, name: `${trigger.name ?? trigger.on}_v2` }));
    await sync();
    const count = async (catalogue: string) => {
      const [row] = await pool.all<{ n: number }>(`SELECT count(*)::int AS n FROM ${catalogue}`);
      assertDefined(row);
      return row.n;
    };
    expect(await count(`pg_proc WHERE proname LIKE '\\_uql\\_%'`)).toBe(
      await count(`pg_trigger WHERE tgname LIKE '\\_uql\\_%'`),
    );
    meta.triggers = declared;
    await sync();
  });

  // A BEFORE DELETE whose function returns NULL cancels the delete, so this proves the return value too.
  it('should let a delete through when a before-delete trigger runs', async () => {
    const id = await pool.insertOne(Post, { title: 'Going', views: 0 });
    await pool.deleteOneById(Post, id);
    expect(await pool.all(`SELECT 1 FROM "Post" WHERE "id" = ${id}`)).toHaveLength(0);
  });

  it('should fire after a delete, reading the row that went', async () => {
    const id = await pool.insertOne(Post, { title: 'Doomed', views: 0 });
    await pool.deleteOneById(Post, id);
    const [row] = await pool.all<{ postId: number }>(`SELECT "postId" FROM "Trash" WHERE "postId" = ${id}`);
    expect(row.postId).toBe(id);
  });

  it('should fire where its own condition holds', async () => {
    const id = await pool.insertOne(Post, { title: 'Viral', views: 500 });
    const rows = await pool.all<{ postId: number }>(`SELECT "postId" FROM "Trash" WHERE "postId" = ${id}`);
    expect(rows).toHaveLength(1);
  });

  it('should carry quotes, wildcards and dollar quotes through a condition and a body intact', async () => {
    const id = await pool.insertOne(Post, { title: "it's 100% $$", views: 0 });
    const other = await pool.insertOne(Post, { title: 'its 100 $', views: 0 });
    expect(await pool.all(`SELECT 1 FROM "Trash" WHERE "postId" = ${id}`)).toHaveLength(1);
    expect(await pool.all(`SELECT 1 FROM "Trash" WHERE "postId" = ${other}`)).toHaveLength(0);
  });

  it('should fire on the transition its condition names, and on no other', async () => {
    const published = await pool.insertOne(Post, { title: 'Draft', views: 0 });
    const renamed = await pool.insertOne(Post, { title: 'Draft', views: 0 });
    const republished = await pool.insertOne(Post, { title: 'Featured', views: 0 });
    await pool.updateOneById(Post, published, { title: 'Published' });
    await pool.updateOneById(Post, renamed, { title: 'Renamed' });
    await pool.updateOneById(Post, republished, { title: 'Published' });
    const trashed = async (id: unknown) => (await pool.all(`SELECT 1 FROM "Trash" WHERE "postId" = ${id}`)).length;
    expect(await trashed(published)).toBe(1);
    expect(await trashed(renamed)).toBe(0);
    expect(await trashed(republished)).toBe(0);
  });

  it('should not fire where its condition does not', async () => {
    const id = await pool.insertOne(Post, { title: 'Quiet', views: 1 });
    const rows = await pool.all<{ postId: number }>(`SELECT "postId" FROM "Trash" WHERE "postId" = ${id}`);
    expect(rows).toHaveLength(0);
  });
});
