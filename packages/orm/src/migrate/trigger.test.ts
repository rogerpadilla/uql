// One suite over every engine that has triggers, because the machinery is meant to be one rule: the
// guard is spelled three ways, the body lives in a function or inline, the rows arrive as records or as
// tables, and only an engine that fires one says whether the emulation of any of that is right.
//
// Each body writes a second table, the one shape every engine allows (the MySQL family refuses a write to
// the table firing, SQL Server has no BEFORE), and is written once, as `insertInto` and the like render it.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { Entity, Field, getMeta, Id, removeEntity, Trigger } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import { provisioningTimeout } from '../test/index.js';
import { dropTables, sqlPools } from '../test/sqlPools.js';
import type { SqlQuerierPool } from '../type/index.js';
import { raw } from '../util/raw.js';
import { deleteFrom, insertInto, updateTable } from '../util/triggerWrite.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

@Trigger({
  on: 'afterUpdate',
  of: (post) => [post.title],
  name: 'audit',
  run: (newRow) => insertInto(TgAudit, { postId: newRow.id }),
})
@Entity({ name: 'TgPost' })
class TgPost {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ type: Number }) views?: number | null;
}

@Entity({ name: 'TgAudit' })
class TgAudit {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) postId?: number | null;
}

const TRIGGER_POOLS = sqlPools('test_trigger');

describe.each(TRIGGER_POOLS)('a trigger on %s', (_engine, connect) => {
  let pool: SqlQuerierPool;
  const entities = [TgAudit, TgPost];

  const sync = (options = {}) => new Migrator(pool, { entities }).sync({ logging: false, ...options });
  const plan = () => new Migrator(pool, { entities }).planSync();
  const audit = [expect.stringMatching(/^_uql_TgPost__audit_[0-9a-f]{6}$/)];

  /** What uql has installed on the post table, read through the introspector every engine implements. */
  const installed = async () => {
    return [...(await introspectorFor(pool).ownedTriggers('TgPost')).keys()];
  };

  const audited = (postId: TgAudit['postId']) => pool.count(TgAudit, { $where: { postId } });

  const tables = ['TgPost', 'TgAudit'] as const;

  beforeAll(async () => {
    pool = connect();
    await dropTables(pool, ...tables);
    await sync();
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, ...tables);
    await pool.end();
  }, provisioningTimeout);

  it('should fire on an update that touches the watched column', async () => {
    const id = await pool.insertOne(TgPost, { title: 'First', views: 0 });
    await pool.updateOneById(TgPost, id, { title: 'Second' });
    expect(await audited(id)).toBe(1);
  });

  // Where the engine has no `WHEN`, this is what proves the condition wrapping the body means the same.
  it('should not fire on an update leaving the watched column alone', async () => {
    const id = await pool.insertOne(TgPost, { title: 'Third', views: 0 });
    await pool.updateOneById(TgPost, id, { views: 9 });
    expect(await audited(id)).toBe(0);
  });

  // The guard compares values, not assignments: a set-based engine reaches them over a join rather than
  // asking `UPDATE(col)`, so the same declaration means the same thing on all of them.
  it('should not fire when the watched column is assigned the value it already held', async () => {
    const id = await pool.insertOne(TgPost, { title: 'Same', views: 0 });
    await pool.updateOneById(TgPost, id, { title: 'Same' });
    expect(await audited(id)).toBe(0);
  });

  // SQL Server fires once for the statement, so the rows the body writes from are narrowed to the ones
  // whose watched column moved, as a per-row engine fires for those alone.
  it('should fire for each row of a statement whose watched column moved, and no other', async () => {
    const [moved, kept] = await pool.insertMany(TgPost, [
      { title: 'Before', views: 0 },
      { title: 'Kept', views: 0 },
    ]);
    await pool.run(
      `UPDATE ${pool.dialect.escapeId('TgPost')} SET ${pool.dialect.escapeId('title')} = CASE ` +
        `WHEN ${pool.dialect.escapeId('id')} = ${moved} THEN 'After' ELSE ${pool.dialect.escapeId('title')} END ` +
        `WHERE ${pool.dialect.escapeId('id')} IN (${moved}, ${kept})`,
    );
    expect([await audited(moved), await audited(kept)]).toEqual([1, 0]);
  });

  it('should install it under a name uql owns', async () => {
    expect(await installed()).toEqual(audit);
  });

  // What a drift check reads, and what keeps `generate:entities` from writing a migration every run.
  it('should leave nothing for a second sync to run', async () => {
    expect(await plan()).toEqual([]);
  });

  it('should replace an edited trigger with the new one, leaving nothing behind', async () => {
    const meta = getMeta(TgPost);
    const declared = meta.triggers;
    assertDefined(declared);
    const before = await installed();
    const [trigger] = declared;
    assertDefined(trigger);
    meta.triggers = [{ ...trigger, of: ['title', 'views'] }];
    await sync();
    const after = await installed();
    expect(after).toEqual(audit);
    expect(after).not.toEqual(before);
    expect(await plan()).toEqual([]);
    meta.triggers = declared;
    await sync();
  });

  it('should drop a trigger the entity no longer declares', async () => {
    const meta = getMeta(TgPost);
    const declared = meta.triggers;
    assertDefined(declared);
    meta.triggers = [];
    await sync();
    expect(await installed()).toEqual([]);
    meta.triggers = declared;
    await sync();
  });

  // A generated migration's `down` puts back what stood there, as the engine reprints it.
  it('should roll an edited trigger forward and back through a generated migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uql-trigger-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const migrator = new Migrator(pool, { entities, migrationsPath: dir });
    const meta = getMeta(TgPost);
    const declared = meta.triggers;
    assertDefined(declared);
    const before = await installed();

    const [trigger] = declared;
    assertDefined(trigger);
    meta.triggers = [{ ...trigger, of: ['views'] }];
    await migrator.generateFromEntities('edit_audit');
    await migrator.up();
    expect(await installed()).not.toEqual(before);
    expect(await migrator.generateFromEntities('again')).toBe('');

    meta.triggers = declared;
    await migrator.down();
    expect(await installed()).toEqual(before);
    const id = await pool.insertOne(TgPost, { title: 'Rolled', views: 0 });
    await pool.updateOneById(TgPost, id, { title: 'Rolled back' });
    await pool.updateOneById(TgPost, id, { views: 1 });
    expect(await audited(id)).toBe(1);
  });

  // Postgres refuses to retype a column a trigger names, so the trigger comes off around the alter.
  it('should retype a column the trigger watches, and keep it firing', async () => {
    const meta = getMeta(TgPost);
    const title = meta.fields.title;
    assertDefined(title);
    meta.fields.title = { ...title, length: 300 };
    await sync({ safe: false });
    expect(await installed()).toEqual(audit);
    const id = await pool.insertOne(TgPost, { title: 'Retyped', views: 0 });
    await pool.updateOneById(TgPost, id, { title: 'Retyped again' });
    expect(await audited(id)).toBe(1);
    meta.fields.title = title;
    await sync({ safe: false });
  });

  // The narrowed sync takes the same path as the whole one, or a trigger would install on one and not the other.
  it('should reconcile when syncing the one entity', async () => {
    const meta = getMeta(TgPost);
    const declared = meta.triggers;
    assertDefined(declared);
    meta.triggers = [];
    await sync({ entity: TgPost });
    expect(await installed()).toEqual([]);
    meta.triggers = declared;
    await sync({ entity: TgPost });
    expect(await installed()).toEqual(audit);
  });
});

// Writing a second table with its own generated key, whose counter runs ahead of the first's: every
// engine has to hand back the ids of the rows an insert wrote, never the log's. A statement touching
// several rows is what tells SQL Server's one firing per statement from the others' one per row.
@Trigger(
  {
    on: 'afterInsert',
    name: 'log',
    run: (newRow) => insertInto(TgLog, { postId: newRow.id, title: newRow.title, source: "it's" }),
  },
  {
    on: 'afterUpdate',
    name: 'relog',
    run: (newRow) => updateTable(TgLog, { $where: { postId: newRow.id } }, { title: newRow.title }),
  },
  { on: 'afterDelete', name: 'unlog', run: (_newRow, oldRow) => deleteFrom(TgLog, { $where: { postId: oldRow.id } }) },
  {
    on: 'afterInsert',
    name: 'flag',
    where: { $new: { title: 'flagged' } },
    run: (newRow) => insertInto(TgLog, { postId: newRow.id, source: 'flag' }),
  },
  {
    on: 'afterUpdate',
    name: 'unflag',
    where: { $old: { title: 'flagged' } },
    run: (newRow) =>
      raw`${deleteFrom(TgLog, { $where: { postId: newRow.id, source: 'flag' } })}
        ${insertInto(TgLog, { postId: newRow.id, source: 'unflag' })}`,
  },
)
@Entity({ name: 'TgLogged' })
class TgLogged {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
}

// A column named apart from its key, and a literal holding a quote, both carried into each engine's body.
@Entity({ name: 'TgLog' })
class TgLog {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number, name: 'post_id' }) postId?: number | null;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) source?: string | null;
}

describe.each(TRIGGER_POOLS)('triggers writing a table of their own on %s', (_engine, connect) => {
  let pool: SqlQuerierPool;
  const tables = ['TgLogged', 'TgLog'] as const;

  const logsOf = (ids: TgLogged['id'][]) =>
    pool.findMany(TgLog, {
      $select: { postId: true, title: true, source: true },
      $where: { postId: { $in: ids } },
      $sort: { postId: 'asc' },
    });

  beforeAll(async () => {
    pool = connect();
    await dropTables(pool, ...tables);
    await new Migrator(pool, { entities: [TgLog, TgLogged] }).sync({ logging: false });
    await pool.insertMany(
      TgLog,
      Array.from({ length: 50 }, () => ({ postId: 0 })),
    );
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, ...tables);
    await pool.end();
  }, provisioningTimeout);

  it('should hand back the id of the row it inserted, not the one its trigger did', async () => {
    const id = await pool.insertOne(TgLogged, { title: 'one' });
    expect(await pool.findMany(TgLogged, { $select: { title: true }, $where: { id } })).toEqual([{ title: 'one' }]);
  });

  it('should hand back the id of every row a batch inserted', async () => {
    const ids = await pool.insertMany(TgLogged, [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    const rows = await pool.findMany(TgLogged, { $select: { id: true, title: true }, $where: { id: { $in: ids } } });
    expect(rows.map((row) => row.title).toSorted()).toEqual(['a', 'b', 'c']);
  });

  it('should insert a log for each row a statement inserted, reading each one', async () => {
    const ids = await pool.insertMany(TgLogged, [{ title: 'a' }, { title: 'b' }]);
    expect(await logsOf(ids)).toEqual([
      { postId: ids[0], title: 'a', source: "it's" },
      { postId: ids[1], title: 'b', source: "it's" },
    ]);
  });

  it('should update the log of each row a statement updated, and no other', async () => {
    const [kept, ...updated] = await pool.insertMany(TgLogged, [{ title: 'kept' }, { title: 'c' }, { title: 'd' }]);
    await pool.updateMany(TgLogged, { $where: { id: { $in: updated } } }, { title: 'bulk' });
    expect((await logsOf([kept, ...updated])).map((log) => log.title)).toEqual(['kept', 'bulk', 'bulk']);
  });

  // SQL Server fires once for the statement, so a where narrows the rows each write reads: proven here
  // on a statement touching a row it selects and one it does not, on insert and on update.
  it('should write only for the rows of a statement its where selects', async () => {
    const ids = await pool.insertMany(TgLogged, [{ title: 'flagged' }, { title: 'plain' }]);
    await pool.updateMany(TgLogged, { $where: { id: { $in: ids } } }, { title: 'cleared' });
    const marks = (await logsOf(ids))
      .filter((log) => log.source !== "it's")
      .map((log) => `${log.postId}:${log.source}`);
    expect(marks).toEqual([`${ids[0]}:unflag`]);
  });

  it('should delete the log of each row a statement deleted, and no other', async () => {
    const [kept, ...deleted] = await pool.insertMany(TgLogged, [{ title: 'kept' }, { title: 'e' }, { title: 'f' }]);
    await pool.deleteMany(TgLogged, { $where: { id: { $in: deleted } } });
    expect((await logsOf([kept, ...deleted])).map((log) => log.title)).toEqual(['kept']);
  });
});

afterAll(() => {
  removeEntity(TgPost);
  removeEntity(TgAudit);
  removeEntity(TgLogged);
  removeEntity(TgLog);
});
