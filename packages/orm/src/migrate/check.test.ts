// One suite over every SQL engine, because a check is one rule: installed under a name ending in a hash of
// its SQL, read back by name, replaced when the name changes. Only a database says the engine took the DDL,
// enforces it, and reports it back under that name.

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineField, Entity, Field, getMeta, Id } from '../entity/index.js';
import type { EnumValues } from '../schema/types.js';
import { assertDefined, linkUqlOrmSource, migrationsDir } from '../test/index.js';
import { dropTables, sqlPools, syncedPool } from '../test/sqlPools.js';
import { sql } from '../util/sql.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

@Entity({ name: 'CkBill', checks: [{ name: 'cap', where: (bill) => sql`${bill.spent} <= ${bill.balance}` }] })
class CkBill {
  @Id({ type: Number }) id?: number;
  status?: string | null;
  @Field({ type: Number }) spent?: number | null;
  @Field({ type: Number }) balance?: number | null;
  @Field({ type: String, columnType: 'varchar', length: 20 }) note?: string | null;
}

// Its values declared as data, so the property admits any string: the tests widen them.
defineField(CkBill, 'status', { type: String, columnType: 'varchar', length: 20, enum: ['draft', 'paid'] });

@Entity({ name: 'CkHand', checks: [{ where: { n: { $lte: 100 } } }] })
class CkHand {
  // Not generated, so it matches the table the test writes by hand, and the check is all that differs.
  @Id({ type: Number, autoIncrement: false }) id?: number;
  @Field({ type: Number }) n?: number | null;
}

describe.each(sqlPools('test_check'))('a check on %s', (_engine, connect, { features }) => {
  const pool = syncedPool(connect, [CkBill, CkHand]);
  const meta = getMeta(CkBill);
  const status = expect.stringMatching(/^_uql_CkBill__status_[0-9a-f]{6}$/);

  const sync = (options = {}) => new Migrator(pool(), { entities: [CkBill] }).sync(options);
  const plan = () => new Migrator(pool(), { entities: [CkBill] }).planSync({ safe: false });

  /** The names of the checks on `name`, the bill table by default, as the engine reports them. */
  const installed = async (name = 'CkBill') => {
    const table = (await introspectorFor(pool()).introspect([name])).getTable(name);
    assertDefined(table);
    return table.checks.map((check) => check.name).sort();
  };

  /** Runs `change` for the test, and `undo` when it finishes, its rows gone so the old checks hold again. */
  const meanwhile = (change: () => void, undo: () => void) => {
    change();
    onTestFinished(async () => {
      undo();
      await pool().deleteMany(CkBill, {}, { unfiltered: true });
      await sync({ safe: false });
    });
  };

  /** Declares `field` as `options` for the test. */
  const redeclare = (field: 'status' | 'note', options: { readonly enum?: EnumValues; readonly name?: string }) => {
    const declared = meta.fields[field];
    assertDefined(declared);
    meanwhile(
      () => {
        meta.fields[field] = { ...declared, ...options };
      },
      () => {
        meta.fields[field] = declared;
      },
    );
  };

  const insert = (row: Partial<CkBill>) => pool().insertOne(CkBill, { spent: 0, balance: 0, ...row });

  it('should install each check under a name uql owns, and enforce it', async () => {
    expect(await installed()).toEqual([expect.stringMatching(/^_uql_CkBill__cap_[0-9a-f]{6}$/), status]);
    await expect(insert({ status: 'void' })).rejects.toThrow();
    await expect(insert({ spent: 2, balance: 1 })).rejects.toThrow();
  });

  it('should leave nothing for a second sync to run', async () => {
    expect(await plan()).toEqual([]);
  });

  it('should replace the check of an enum that gains a value', async () => {
    const before = await installed();
    redeclare('status', { enum: ['draft', 'paid', 'void'] });

    await sync({ safe: false });

    await insert({ status: 'void' });
    expect(await installed()).not.toEqual(before);
    expect(await plan()).toEqual([]);
  });

  it('should keep the old check of a changed one in safe mode, which goes on enforcing itself', async () => {
    redeclare('status', { enum: ['draft', 'paid', 'void'] });

    await sync();

    await expect(insert({ status: 'void' })).rejects.toThrow();
  });

  // Where the engine alters no constraint, adding one rebuilds the table, which safe mode holds back whole.
  it.skipIf(features.rebuildsTables)('should add the changed check beside the old one in safe mode', async () => {
    const before = await installed();
    redeclare('status', { enum: ['draft', 'paid', 'void'] });

    await sync();

    expect((await installed()).filter((name) => !before.includes(name))).toEqual([status]);
  });

  it('should constrain a column that comes to declare an enum', async () => {
    redeclare('note', { enum: ['a', 'b'] });

    await sync();

    await insert({ note: 'a' });
    await expect(insert({ note: 'z' })).rejects.toThrow();
  });

  it('should replace an edited check', async () => {
    const declared = meta.checks;
    meanwhile(
      () => {
        meta.checks = [{ name: 'cap', where: sql`spent < balance` }];
      },
      () => {
        meta.checks = declared;
      },
    );

    await sync({ safe: false });

    await expect(insert({ spent: 1, balance: 1 })).rejects.toThrow();
    expect(await plan()).toEqual([]);
  });

  // A generated migration's `down` puts back what stood there, as the engine reprints it.
  it('should roll a widened enum forward and back through a generated migration', async () => {
    const migrator = new Migrator(pool(), { entities: [CkBill], migrationsPath: await migrationsDir() });
    const before = await installed();
    redeclare('status', { enum: ['draft', 'paid', 'void'] });

    await linkUqlOrmSource(await migrator.generateFromEntities('widen_status'));
    expect(await migrator.up()).toMatchObject([{ direction: 'up' }]);
    expect(await migrator.generateFromEntities('again')).toBe('');
    expect(await migrator.down()).toMatchObject([{ direction: 'down' }]);

    expect(await installed()).toEqual(before);
    await expect(insert({ status: 'void' })).rejects.toThrow();
  });

  // MySQL refuses to rename a column a check names, so the old check comes off before the rename.
  it('should rename a column under its check through a generated migration, and back', async () => {
    const migrator = new Migrator(pool(), { entities: [CkBill], migrationsPath: await migrationsDir() });
    redeclare('status', { name: 'state' });

    await linkUqlOrmSource(await migrator.generateFromEntities('rename_status'));
    expect(await migrator.up()).toMatchObject([{ direction: 'up' }]);
    await insert({ status: 'draft' });
    await expect(insert({ status: 'void' })).rejects.toThrow();
    expect(await migrator.down()).toMatchObject([{ direction: 'down' }]);
  });

  // SQLite adds the declared check by rebuilding the table, which has to carry this one along.
  it('should leave a check uql did not install, and warn about it beside the ones it declares', async () => {
    await dropTables(pool(), 'CkHand');
    const id = (name: string) => pool().dialect.escapeId(name);
    await pool().run(
      sql.text(
        `CREATE TABLE ${id('CkHand')} (${id('id')} BIGINT PRIMARY KEY, ${id('n')} BIGINT, CONSTRAINT hand_ck CHECK (n >= 0))`,
      ),
    );
    const migrator = new Migrator(pool(), { entities: [CkHand] });
    const warn = vi.spyOn(migrator.logger, 'logWarn');

    await migrator.sync({ safe: false });

    expect(await installed('CkHand')).toEqual([expect.stringMatching(/^_uql_CkHand__ck_[0-9a-f]{6}$/), 'hand_ck']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hand_ck'));
  });
});
