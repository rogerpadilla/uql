// One suite over every engine with triggers, since the machinery is one rule however an engine spells the
// guard, keeps the body or hands it the rows. A body every engine runs writes a second table: the MySQL
// family refuses a write to the table firing, and SQL Server has no BEFORE.

import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { Entity, Field, Id, Trigger } from '../entity/index.js';
import { assertDefined, linkUqlOrmSource, migrationsDir, provisioningTimeout } from '../test/index.js';
import { dropTables, sqlPools, syncedPool } from '../test/sqlPools.js';
import type { Type } from '../type/index.js';
import { sql, refs } from '../util/sql.js';
import { deleteFrom, insertInto, refuse, updateTable, upsertInto } from '../util/triggerWrite.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';
import { SqlSchemaGenerator } from './schemaGenerator.js';

@Entity({ name: 'TgAudit' })
class TgAudit {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) postId?: number | null;
}

/** The post table, its audit firing on an update of the column `watched`, its title declared as `title`. */
function tgPost(watched: 'title' | 'views', title: { readonly length?: number; readonly nullable?: false } = {}) {
  @Trigger({
    on: 'afterUpdate',
    of: (post) => [post[watched]],
    name: 'audit',
    run: (newRow) => insertInto(TgAudit, { postId: newRow.id }),
  })
  @Entity({ name: 'TgPost' })
  class TgPost {
    @Id({ type: Number }) id?: number;
    @Field({ type: String, ...title }) title?: string | null;
    @Field({ type: Number }) views?: number | null;
  }
  return TgPost;
}

const TgPost = tgPost('title');
const TgPostWatchingViews = tgPost('views');
// Nullability too, so SQLite, which has no length to retype, rebuilds the table around the trigger.
const TgPostRetyped = tgPost('title', { length: 300, nullable: false });

const TRIGGER_POOLS = sqlPools('test_trigger');

describe.each(TRIGGER_POOLS)('a trigger on %s', (_engine, connect) => {
  const pool = syncedPool(connect, [TgAudit, TgPost]);
  const migrator = (post: Type<object> = TgPost, migrationsPath?: string) =>
    new Migrator(pool(), { entities: [TgAudit, post], migrationsPath });
  const audit = [expect.stringMatching(/^_uql_TgPost__audit_[0-9a-f]{6}$/)];

  /** What uql has installed on the post table, read through the introspector every engine implements. */
  const installed = async () => {
    const table = (await introspectorFor(pool()).introspect(['TgPost'])).getTable('TgPost');
    assertDefined(table);
    return table.triggers.map((trigger) => trigger.name);
  };

  /** Brings the post table back to what `TgPost` declares once the test finishes, whatever it changed. */
  const restoreWhenFinished = () => onTestFinished(() => migrator().sync({ safe: false }));

  const audited = (postId: TgAudit['postId']) => pool().count(TgAudit, { $where: { postId } });

  it('should fire on an update that touches the watched column', async () => {
    const id = await pool().insertOne(TgPost, { title: 'First', views: 0 });
    await pool().updateOneById(TgPost, id, { title: 'Second' });
    expect(await audited(id)).toBe(1);
  });

  // Where the engine has no `WHEN`, this is what proves the condition wrapping the body means the same.
  it('should not fire on an update leaving the watched column alone', async () => {
    const id = await pool().insertOne(TgPost, { title: 'Third', views: 0 });
    await pool().updateOneById(TgPost, id, { views: 9 });
    expect(await audited(id)).toBe(0);
  });

  // The guard compares values, not assignments: a set-based engine reaches them over a join rather than
  // asking `UPDATE(col)`, so the same declaration means the same thing on all of them.
  it('should not fire when the watched column is assigned the value it already held', async () => {
    const id = await pool().insertOne(TgPost, { title: 'Same', views: 0 });
    await pool().updateOneById(TgPost, id, { title: 'Same' });
    expect(await audited(id)).toBe(0);
  });

  // SQL Server fires once for the statement, so the rows the body writes from are narrowed to the ones
  // whose watched column moved, as a per-row engine fires for those alone.
  it('should fire for each row of a statement whose watched column moved, and no other', async () => {
    const [moved, kept] = await pool().insertMany(TgPost, [
      { title: 'Before', views: 0 },
      { title: 'Kept', views: 0 },
    ]);
    const [table, title, key] = ['TgPost', 'title', 'id'].map((name) => pool().dialect.escapeId(name));
    await pool().run(
      sql.text(
        `UPDATE ${table} SET ${title} = CASE WHEN ${key} = ${moved} THEN 'After' ELSE ${title} END ` +
          `WHERE ${key} IN (${moved}, ${kept})`,
      ),
    );
    expect([await audited(moved), await audited(kept)]).toEqual([1, 0]);
  });

  it('should install it under a name uql owns', async () => {
    expect(await installed()).toEqual(audit);
  });

  // What a drift check reads, and what keeps `generate:entities` from writing a migration every run.
  it('should leave nothing for a second sync to run', async () => {
    expect(await migrator().planSync({ safe: false })).toEqual([]);
  });

  it('should replace an edited trigger with the new one, leaving nothing behind', async () => {
    restoreWhenFinished();
    const before = await installed();
    const edited = migrator(TgPostWatchingViews);

    await edited.sync();

    const after = await installed();
    expect(after).toEqual(audit);
    expect(after).not.toEqual(before);
    expect(await edited.planSync({ safe: false })).toEqual([]);
  });

  it('should drop a trigger the entity no longer declares', async () => {
    @Entity({ name: 'TgPost' })
    class Untriggered {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) title?: string | null;
      @Field({ type: Number }) views?: number | null;
    }
    restoreWhenFinished();

    await migrator(Untriggered).sync();

    expect(await installed()).toEqual([]);
  });

  // A generated migration's `down` puts back what stood there, as the engine reprints it.
  it('should roll an edited trigger forward and back through a generated migration', async () => {
    restoreWhenFinished();
    const before = await installed();
    const edit = migrator(TgPostWatchingViews, await migrationsDir());

    await linkUqlOrmSource(await edit.generateFromEntities('edit_audit'));
    expect(await edit.up()).toMatchObject([{ direction: 'up' }]);
    expect(await installed()).not.toEqual(before);
    expect(await edit.generateFromEntities('again')).toBe('');
    expect(await edit.down()).toMatchObject([{ direction: 'down' }]);

    expect(await installed()).toEqual(before);
    const id = await pool().insertOne(TgPost, { title: 'Rolled', views: 0 });
    await pool().updateOneById(TgPost, id, { title: 'Rolled back' });
    await pool().updateOneById(TgPost, id, { views: 1 });
    expect(await audited(id)).toBe(1);
  });

  // Postgres refuses to retype a column a trigger names, so the trigger comes off around the alter.
  it('should retype a column the trigger watches, and keep it firing', async () => {
    restoreWhenFinished();

    await migrator(TgPostRetyped).sync({ safe: false });

    expect(await installed()).toEqual(audit);
    const id = await pool().insertOne(TgPostRetyped, { title: 'Retyped', views: 0 });
    await pool().updateOneById(TgPostRetyped, id, { title: 'Retyped again' });
    expect(await audited(id)).toBe(1);
  });

  // A generated migration's `down` takes the triggers off around the reverse retype too, then puts back what stood.
  it('should retype a watched column through a generated migration, and back', async () => {
    restoreWhenFinished();
    const before = await installed();
    const retype = migrator(TgPostRetyped, await migrationsDir());

    await linkUqlOrmSource(await retype.generateFromEntities('retype_title'));
    expect(await retype.up()).toMatchObject([{ direction: 'up' }]);
    expect(await retype.down()).toMatchObject([{ direction: 'down' }]);

    expect(await installed()).toEqual(before);
    expect(await migrator().planSync({ safe: false })).toEqual([]);
    const id = await pool().insertOne(TgPost, { title: 'Reverted', views: 0 });
    await pool().updateOneById(TgPost, id, { title: 'Reverted again' });
    expect(await audited(id)).toBe(1);
  });

  // The narrowed sync takes the same path as the whole one, or a trigger would install on one and not the other.
  it('should reconcile when syncing the one entity', async () => {
    restoreWhenFinished();
    const before = await installed();

    await migrator(TgPostWatchingViews).sync({ entity: TgPostWatchingViews });
    const edited = await installed();
    await migrator().sync({ entity: TgPost });

    expect(edited).toEqual(audit);
    expect(edited).not.toEqual(before);
    expect(await installed()).toEqual(before);
  });

  // A table's drop leaves the function the Postgres family keeps each body in, so `down` drops it after the table.
  it(
    'should create a table with its triggers through a generated migration, and drop both on the way down',
    async () => {
      restoreWhenFinished();
      await dropTables(pool(), 'TgPost');
      const create = migrator(TgPost, await migrationsDir());

      await linkUqlOrmSource(await create.generateFromEntities('create_post'));
      expect(await create.up()).toMatchObject([{ direction: 'up' }]);
      expect(await installed()).toEqual(audit);
      expect(await create.down()).toMatchObject([{ direction: 'down' }]);

      expect(await introspectorFor(pool()).tableExists('TgPost')).toBe(false);
    },
    provisioningTimeout,
  );
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
      sql`${deleteFrom(TgLog, { $where: { postId: newRow.id, source: 'flag' } })}
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
  const pool = syncedPool(connect, [TgLog, TgLogged]);

  beforeAll(async () => {
    await pool().insertMany(
      TgLog,
      Array.from({ length: 50 }, () => ({ postId: 0 })),
    );
  }, provisioningTimeout);

  const logsOf = (ids: TgLogged['id'][]) =>
    pool().findMany(TgLog, {
      $select: { postId: true, title: true, source: true },
      $where: { postId: { $in: ids } },
      $sort: { postId: 'asc' },
    });

  it('should hand back the id of the row it inserted, not the one its trigger did', async () => {
    const id = await pool().insertOne(TgLogged, { title: 'one' });
    expect(await pool().findOneById(TgLogged, id, { $select: { title: true } })).toEqual({ title: 'one' });
  });

  it('should hand back the id of every row a batch inserted', async () => {
    const ids = await pool().insertMany(TgLogged, [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    const rows = await pool().findMany(TgLogged, {
      $select: { id: true, title: true },
      $where: { id: { $in: ids } },
      $sort: { id: 'asc' },
    });
    expect(rows).toEqual([
      { id: ids[0], title: 'a' },
      { id: ids[1], title: 'b' },
      { id: ids[2], title: 'c' },
    ]);
  });

  it('should insert a log for each row a statement inserted, reading each one', async () => {
    const ids = await pool().insertMany(TgLogged, [{ title: 'a' }, { title: 'b' }]);
    expect(await logsOf(ids)).toEqual([
      { postId: ids[0], title: 'a', source: "it's" },
      { postId: ids[1], title: 'b', source: "it's" },
    ]);
  });

  it('should update the log of each row a statement updated, and no other', async () => {
    const [kept, ...updated] = await pool().insertMany(TgLogged, [{ title: 'kept' }, { title: 'c' }, { title: 'd' }]);
    await pool().updateMany(TgLogged, { $where: { id: { $in: updated } } }, { title: 'bulk' });
    expect((await logsOf([kept, ...updated])).map((log) => log.title)).toEqual(['kept', 'bulk', 'bulk']);
  });

  // SQL Server fires once for the statement, so a where narrows the rows each write reads: proven here
  // on a statement touching a row it selects and one it does not, on insert and on update.
  it('should write only for the rows of a statement its where selects', async () => {
    const ids = await pool().insertMany(TgLogged, [{ title: 'flagged' }, { title: 'plain' }]);
    await pool().updateMany(TgLogged, { $where: { id: { $in: ids } } }, { title: 'cleared' });
    const marks = (await logsOf(ids))
      .filter((log) => log.source !== "it's")
      .map((log) => `${log.postId}:${log.source}`);
    expect(marks).toEqual([`${ids[0]}:unflag`]);
  });

  it('should delete the log of each row a statement deleted, and no other', async () => {
    const [kept, ...deleted] = await pool().insertMany(TgLogged, [{ title: 'kept' }, { title: 'e' }, { title: 'f' }]);
    await pool().deleteMany(TgLogged, { $where: { id: { $in: deleted } } });
    expect((await logsOf([kept, ...deleted])).map((log) => log.title)).toEqual(['kept']);
  });
});

@Trigger({ on: 'afterDelete', name: 'kept', run: () => refuse("ledger rows are kept: it's final") })
@Trigger({ on: 'afterUpdate', name: 'frozen', where: { $old: { frozen: true } }, run: () => refuse('frozen') })
@Entity({ name: 'TgLedger' })
class TgLedger {
  @Id({ type: Number }) id?: number;
  @Field({ type: Boolean }) frozen?: boolean | null;
  @Field({ type: Number }) amount?: number | null;
}

describe.each(TRIGGER_POOLS)('a refusal on %s', (_engine, connect) => {
  const pool = syncedPool(connect, [TgLedger]);

  it('should fail the write with its message, and leave the row as it was', async () => {
    const id = await pool().insertOne(TgLedger, { amount: 1 });
    await expect(pool().deleteMany(TgLedger, { $where: { id } })).rejects.toThrow("ledger rows are kept: it's final");
    expect(await pool().count(TgLedger, { $where: { id } })).toBe(1);
  });

  it('should refuse only the rows its where selects', async () => {
    const [open, frozen] = await pool().insertMany(TgLedger, [
      { frozen: false, amount: 1 },
      { frozen: true, amount: 1 },
    ]);
    await pool().updateOneById(TgLedger, open, { amount: 2 });
    await expect(pool().updateOneById(TgLedger, frozen, { amount: 2 })).rejects.toThrow('frozen');
    expect(await pool().findOneById(TgLedger, frozen, { $select: { amount: true } })).toEqual({ amount: 1 });
  });
});

@Trigger({
  on: 'afterInsert',
  deferred: true,
  where: { $new: { amount: { $ne: 0 } } },
  run: () => refuse('unbalanced'),
})
@Entity({ name: 'TgEntry' })
class TgEntry {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) amount?: number | null;
}

describe.each(TRIGGER_POOLS.filter(([, , { features }]) => features.triggers.deferrable))(
  'a deferred trigger on %s',
  (_engine, connect) => {
    const pool = syncedPool(connect, [TgEntry]);

    it('should let the statement through and fail the commit', async () => {
      let inserted = false;
      await expect(
        pool().transaction(async (querier) => {
          await querier.insertOne(TgEntry, { amount: 5 });
          inserted = true;
        }),
      ).rejects.toThrow('unbalanced');
      expect(inserted).toBe(true);
      expect(await pool().count(TgEntry, {})).toBe(0);
    });

    it('should commit what it lets through', async () => {
      await pool().transaction((querier) => querier.insertOne(TgEntry, { amount: 0 }));
      expect(await pool().count(TgEntry, {})).toBe(1);
    });
  },
);

@Trigger(
  {
    on: 'afterInsert',
    name: 'last',
    run: (newRow) => upsertInto(TgLast, { sku: true }, { sku: newRow.sku, qty: newRow.qty }),
  },
  {
    on: 'afterInsert',
    name: 'first',
    run: (newRow) => upsertInto(TgFirst, { sku: true }, { sku: newRow.sku, qty: newRow.qty }, {}),
  },
)
@Entity({ name: 'TgSale' })
class TgSale {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) sku?: string | null;
  @Field({ type: Number }) qty?: number | null;
}

@Entity({ name: 'TgLast' })
class TgLast {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 20, unique: true }) sku?: string | null;
  @Field({ type: Number }) qty?: number | null;
}

@Entity({ name: 'TgFirst' })
class TgFirst {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 20, unique: true }) sku?: string | null;
  @Field({ type: Number }) qty?: number | null;
}

describe.each(TRIGGER_POOLS)('an upsert in a trigger on %s', (_engine, connect) => {
  const pool = syncedPool(connect, [TgLast, TgFirst, TgSale]);
  const qtyOf = async (entity: typeof TgLast | typeof TgFirst, sku: string) =>
    (await pool().findMany(entity, { $select: { qty: true }, $where: { sku } })).map((row) => row.qty);

  it('should insert a row, and on its conflict paths take the incoming one', async () => {
    await pool().insertOne(TgSale, { sku: 'a', qty: 1 });
    await pool().insertOne(TgSale, { sku: 'a', qty: 5 });
    expect(await qtyOf(TgLast, 'a')).toEqual([5]);
  });

  it('should leave a conflicting row as it is on an empty update', async () => {
    await pool().insertOne(TgSale, { sku: 'b', qty: 1 });
    await pool().insertOne(TgSale, { sku: 'b', qty: 5 });
    expect(await qtyOf(TgFirst, 'b')).toEqual([1]);
  });
});

@Trigger(
  {
    on: 'afterInsert',
    name: 'count',
    run: (newRow) => upsertInto(TgCount, { sku: true }, { sku: newRow.sku, hits: 1 }, { hits: { $inc: 1 } }),
  },
  {
    on: 'afterInsert',
    name: 'total',
    run: (newRow) =>
      upsertInto(
        TgTotal,
        { sku: true },
        { sku: newRow.sku, total: newRow.qty },
        { total: sql`${refs(TgTotal).total} + ${newRow.qty}` },
      ),
  },
)
@Entity({ name: 'TgOrder' })
class TgOrder {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) sku?: string | null;
  @Field({ type: Number }) qty?: number | null;
}

@Entity({ name: 'TgCount' })
class TgCount {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 20, unique: true }) sku?: string | null;
  @Field({ type: Number }) hits?: number | null;
}

@Entity({ name: 'TgTotal' })
class TgTotal {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, length: 20, unique: true }) sku?: string | null;
  @Field({ type: Number }) total?: number | null;
}

// An engine firing once per statement applies one update per target row for it, so a counter is refused there.
describe.each(TRIGGER_POOLS.filter(([, , { features }]) => features.triggers.fires !== 'eachStatement'))(
  'a counting upsert in a trigger on %s',
  (_engine, connect) => {
    const pool = syncedPool(connect, [TgCount, TgTotal, TgOrder]);

    it('should count each row inserted, by $inc and by SQL over the row already there', async () => {
      await pool().insertMany(TgOrder, [
        { sku: 'c', qty: 2 },
        { sku: 'c', qty: 3 },
      ]);
      await pool().insertOne(TgOrder, { sku: 'c', qty: 4 });
      const hits = await pool().findMany(TgCount, { $select: { hits: true }, $where: { sku: 'c' } });
      const totals = await pool().findMany(TgTotal, { $select: { total: true }, $where: { sku: 'c' } });
      expect([hits, totals]).toEqual([[{ hits: 3 }], [{ total: 9 }]]);
    });
  },
);

// What a body kept in a function of its own can do, in the PL/pgSQL only the Postgres family runs: assign to
// the incoming row and read the outgoing one.
@Trigger(
  { on: 'beforeInsert', name: 'slug', run: (newRow) => sql`${newRow.slug} := lower(${newRow.title});` },
  { on: 'beforeDelete', name: 'trash', run: (_newRow, oldRow) => insertInto(TgTrash, { postId: oldRow.id }) },
  // A transition, which `of` alone cannot state: from one value to another.
  {
    on: 'afterUpdate',
    name: 'published',
    where: { $old: { title: 'Draft' }, $new: { title: { $in: ['Published', 'Featured'] } } },
    run: (newRow) => insertInto(TgTrash, { postId: newRow.id }),
  },
  // Every character that could end a literal or the body early: a quote, a LIKE wildcard, a dollar quote.
  {
    on: 'afterInsert',
    name: 'literal',
    where: { $new: { title: "it's 100% $$" } },
    run: (newRow) => sql`INSERT INTO "TgTrash" ("postId") SELECT ${newRow.id} WHERE ${"$$ it's"} <> '';`,
  },
)
@Entity({ name: 'TgSlugged' })
class TgSlugged {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) title?: string | null;
  @Field({ type: String }) slug?: string | null;
}

@Entity({ name: 'TgTrash' })
class TgTrash {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number }) postId?: number | null;
}

describe.each(TRIGGER_POOLS.filter(([, , { features }]) => features.triggers.body === 'function'))(
  'a trigger in a function of its own on %s',
  (_engine, connect) => {
    const pool = syncedPool(connect, [TgTrash, TgSlugged]);
    const trashed = (postId: TgTrash['postId']) => pool().count(TgTrash, { $where: { postId } });

    /** The names of the triggers on `table`, failing the test where it is missing. */
    const installed = async (table: string, schema?: string) => {
      const [node] = (await introspectorFor(pool(), schema).introspect([table])).getTables();
      assertDefined(node);
      return node.triggers.map((trigger) => trigger.name);
    };

    /** How many functions uql keeps in `schema` for the triggers on `table`. */
    const functionsIn = async (schema: string, table: string) =>
      (
        await pool().all(
          sql.text(
            `SELECT 1 FROM information_schema.routines WHERE routine_schema = '${schema}' ` +
              `AND routine_name LIKE '\\_uql\\_${table}\\_%'`,
          ),
        )
      ).length;

    it('should fill the column a before-insert body assigns', async () => {
      const id = await pool().insertOne(TgSlugged, { title: 'Hello World' });
      expect(await pool().findOneById(TgSlugged, id, { $select: { slug: true } })).toEqual({ slug: 'hello world' });
    });

    // A BEFORE DELETE whose function returns NULL cancels the delete, so this proves the return value too.
    it('should let a delete through when a before-delete body reads the row going', async () => {
      const id = await pool().insertOne(TgSlugged, { title: 'Going' });
      await pool().deleteOneById(TgSlugged, id);
      expect([await pool().count(TgSlugged, { $where: { id } }), await trashed(id)]).toEqual([0, 1]);
    });

    it('should carry quotes, wildcards and dollar quotes through a condition and a body intact', async () => {
      const [id, other] = await pool().insertMany(TgSlugged, [{ title: "it's 100% $$" }, { title: 'its 100 $' }]);
      expect([await trashed(id), await trashed(other)]).toEqual([1, 0]);
    });

    it('should fire on the transition its condition names, and on no other', async () => {
      const [published, renamed, republished] = await pool().insertMany(TgSlugged, [
        { title: 'Draft' },
        { title: 'Draft' },
        { title: 'Featured' },
      ]);
      await pool().updateOneById(TgSlugged, published, { title: 'Published' });
      await pool().updateOneById(TgSlugged, renamed, { title: 'Renamed' });
      await pool().updateOneById(TgSlugged, republished, { title: 'Published' });
      expect([await trashed(published), await trashed(renamed), await trashed(republished)]).toEqual([1, 0, 0]);
    });

    // A dropped trigger leaves the function it called, which would pile up with every edited body.
    it('should drop the function of each trigger it drops or replaces', async () => {
      @Trigger({ on: 'beforeInsert', name: 'slug', run: (newRow) => sql`${newRow.slug} := upper(${newRow.title});` })
      @Entity({ name: 'TgSlugged' })
      class Upper {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) title?: string | null;
        @Field({ type: String }) slug?: string | null;
      }
      const declared = new Migrator(pool(), { entities: [TgTrash, TgSlugged] });
      onTestFinished(() => declared.sync({ safe: false }));
      expect([await functionsIn('public', 'TgSlugged'), await declared.planSync({ safe: false })]).toEqual([4, []]);

      await new Migrator(pool(), { entities: [TgTrash, Upper] }).sync();

      expect([await installed('TgSlugged'), await functionsIn('public', 'TgSlugged')]).toEqual([
        [expect.stringMatching(/^_uql_TgSlugged__slug_[0-9a-f]{6}$/)],
        1,
      ]);
    });

    // The catalogue read, the function and its drop all have to name the schema, or a second sync never sees
    // what the first installed and tries to create it again.
    it('should keep the function of a table in a schema of its own there, and drop it with its trigger', async () => {
      @Trigger({ on: 'beforeInsert', name: 'slug', run: (newRow) => sql`${newRow.slug} := lower(${newRow.title});` })
      @Entity({ name: 'TgSchemed', schema: 'tg' })
      class Schemed {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) title?: string | null;
        @Field({ type: String }) slug?: string | null;
      }
      @Entity({ name: 'TgSchemed', schema: 'tg' })
      class Untriggered {
        @Id({ type: Number }) id?: number;
        @Field({ type: String }) title?: string | null;
        @Field({ type: String }) slug?: string | null;
      }
      onTestFinished(async () => {
        for (const statement of new SqlSchemaGenerator(pool().dialect).generateDropSchema([Schemed], {
          ifExists: true,
        })) {
          await pool().run(sql.text(statement));
        }
      });
      const migrator = new Migrator(pool(), { entities: [Schemed] });

      await migrator.sync();
      expect([await functionsIn('tg', 'TgSchemed'), await functionsIn('public', 'TgSchemed')]).toEqual([1, 0]);
      expect(await migrator.planSync({ safe: false })).toEqual([]);

      await new Migrator(pool(), { entities: [Untriggered] }).sync();
      expect([await installed('TgSchemed', 'tg'), await functionsIn('tg', 'TgSchemed')]).toEqual([[], 0]);
    });
  },
);
