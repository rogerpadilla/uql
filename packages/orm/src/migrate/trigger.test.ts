// One suite over every engine that has triggers, because the machinery is meant to be one rule: the
// guard is spelled three ways, the body lives in a function or inline, the rows arrive as records or as
// tables, and only an engine that fires one says whether the emulation of any of that is right.
//
// The trigger writes to a second table on purpose. It is the one shape every engine allows: the MySQL
// family refuses a trigger that updates the table it fires on, and SQL Server has no BEFORE to assign in.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { Entity, Field, getMeta, Id, removeEntity, Trigger } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import { provisioningTimeout } from '../test/index.js';
import { dropTables, SQL_POOLS } from '../test/sqlPools.js';
import type { SqlQuerierPool } from '../type/index.js';
import { raw } from '../util/raw.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

@Trigger({
  on: 'afterUpdate',
  of: (post) => [post.title],
  name: 'audit',
  run: {
    postgres: (newRow) => raw`INSERT INTO "TgAudit" ("postId") VALUES (${newRow.id});`,
    mysql: (newRow) => raw`INSERT INTO \`TgAudit\` (\`postId\`) VALUES (${newRow.id});`,
    sqlite: (newRow) => raw`INSERT INTO \`TgAudit\` (\`postId\`) VALUES (${newRow.id});`,
    mssql: () => raw`INSERT INTO "TgAudit" ("postId") SELECT "id" FROM inserted;`,
  },
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

describe.each(SQL_POOLS)('a trigger on %s', (_engine, connect) => {
  let pool: SqlQuerierPool;
  const entities = [TgAudit, TgPost];

  const sync = (options = {}) => new Migrator(pool, { entities }).sync({ logging: false, ...options });
  const plan = () => new Migrator(pool, { entities }).planSync();
  const audit = [expect.stringMatching(/^_uql_TgPost__audit_[0-9a-f]{6}$/)];

  /** What uql has installed on the post table, read through the introspector every engine implements. */
  const installed = async () => {
    return [...(await introspectorFor(pool).ownedTriggers('TgPost')).keys()];
  };

  const escapeId = (name: string) => pool.dialect.escapeId(name);

  const audited = async (postId: unknown) => {
    const rows = await pool.all(
      `SELECT ${escapeId('postId')} FROM ${escapeId('TgAudit')} WHERE ${escapeId('postId')} = ${postId}`,
    );
    return rows.length;
  };

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

// An insert trigger writing to a second table with its own generated key, whose counter runs ahead of
// the first's: every engine has to hand back the ids of the rows the statement wrote, never the log's.
@Trigger({
  on: 'afterInsert',
  name: 'log',
  run: {
    postgres: (newRow) => raw`INSERT INTO "TgLog" ("postId") VALUES (${newRow.id});`,
    mysql: (newRow) => raw`INSERT INTO \`TgLog\` (\`postId\`) VALUES (${newRow.id});`,
    sqlite: (newRow) => raw`INSERT INTO \`TgLog\` (\`postId\`) VALUES (${newRow.id});`,
    mssql: () => raw`INSERT INTO "TgLog" ("postId") SELECT "id" FROM inserted;`,
  },
})
@Entity({ name: 'TgLogged' })
class TgLogged {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
}

@Entity({ name: 'TgLog' })
class TgLog {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) postId?: number | null;
}

describe.each(SQL_POOLS)('an insert trigger writing a table of its own on %s', (_engine, connect) => {
  let pool: SqlQuerierPool;
  const tables = ['TgLogged', 'TgLog'] as const;

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
});

afterAll(() => {
  removeEntity(TgPost);
  removeEntity(TgAudit);
  removeEntity(TgLogged);
  removeEntity(TgLog);
});
