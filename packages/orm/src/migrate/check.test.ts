// One suite over every SQL engine, because a check is one rule: installed under a name ending in a hash of
// its SQL, read back by name, replaced when the name changes. Only a database says the engine took the DDL,
// enforces it, and reports it back under that name.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Entity, Field, getMeta, Id } from '../entity/index.js';
import type { EnumValues } from '../schema/types.js';
import { assertDefined, provisioningTimeout } from '../test/index.js';
import { dropTables, sqlPools } from '../test/sqlPools.js';
import type { SqlQuerierPool } from '../type/index.js';
import { raw } from '../util/raw.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

@Entity({ name: 'CkBill', checks: [{ name: 'cap', where: (bill) => raw`${bill.spent} <= ${bill.balance}` }] })
class CkBill {
  @Id({ type: Number }) id?: number;
  // Its values are declared in `beforeAll`: the tests widen them, so the property admits any string.
  @Field({ type: String, columnType: 'varchar', length: 20 }) status?: string | null;
  @Field({ type: Number }) spent?: number | null;
  @Field({ type: Number }) balance?: number | null;
  @Field({ type: String, columnType: 'varchar', length: 20 }) note?: string | null;
}

@Entity({ name: 'CkHand', checks: [{ where: { n: { $lte: 100 } } }] })
class CkHand {
  // Not generated, so it matches the table the test writes by hand, and the check is all that differs.
  @Id({ type: Number, autoIncrement: false }) id?: number;
  @Field({ type: Number }) n?: number | null;
}

describe.each(sqlPools('test_check'))('a check on %s', (_engine, connect) => {
  let pool: SqlQuerierPool;
  const entities = [CkBill];
  const meta = getMeta(CkBill);

  const sync = (options = {}) => new Migrator(pool, { entities }).sync({ logging: false, ...options });
  const plan = () => new Migrator(pool, { entities }).planSync({ safe: false });

  /** A migrator writing its migrations to a directory of its own, removed when the test finishes. */
  const migratorWithFiles = async () => {
    const migrationsPath = await mkdtemp(join(tmpdir(), 'uql-check-'));
    onTestFinished(() => rm(migrationsPath, { recursive: true, force: true }));
    return new Migrator(pool, { entities, migrationsPath });
  };

  /** The names of the checks on `name`, the bill table by default, as the engine reports them. */
  const installed = async (name = 'CkBill') => {
    const table = (await introspectorFor(pool).introspect([name])).getTable(name);
    assertDefined(table);
    return table.checks.map((check) => check.name).sort();
  };

  /** Runs `change` for the test, and `undo` when it finishes, its rows gone so the old checks hold again. */
  const meanwhile = (change: () => void, undo: () => void) => {
    change();
    onTestFinished(async () => {
      undo();
      await pool.deleteMany(CkBill, {}, { unfiltered: true });
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

  const insert = (row: Partial<CkBill>) => pool.insertOne(CkBill, { spent: 0, balance: 0, ...row });

  beforeAll(async () => {
    const { status } = meta.fields;
    assertDefined(status);
    meta.fields.status = { ...status, enum: ['draft', 'paid'] };
    pool = connect();
    await dropTables(pool, 'CkBill', 'CkHand');
    await sync();
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, 'CkBill', 'CkHand');
    await pool.end();
  }, provisioningTimeout);

  it('should install each check under a name uql owns, and enforce it', async () => {
    expect(await installed()).toEqual([
      expect.stringMatching(/^_uql_CkBill__cap_[0-9a-f]{6}$/),
      expect.stringMatching(/^_uql_CkBill__status_[0-9a-f]{6}$/),
    ]);
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

  it('should add a changed check in safe mode beside the old one, which goes on enforcing itself', async () => {
    redeclare('status', { enum: ['draft', 'paid', 'void'] });

    await sync();

    await expect(insert({ status: 'void' })).rejects.toThrow();
    expect(await plan()).not.toEqual([]);
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
        meta.checks = [{ name: 'cap', where: raw`spent < balance` }];
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
    const migrator = await migratorWithFiles();
    const before = await installed();
    redeclare('status', { enum: ['draft', 'paid', 'void'] });

    await migrator.generateFromEntities('widen_status');
    expect(await migrator.up()).toMatchObject([{ success: true }]);
    expect(await migrator.generateFromEntities('again')).toBe('');
    expect(await migrator.down()).toMatchObject([{ success: true }]);

    expect(await installed()).toEqual(before);
    await expect(insert({ status: 'void' })).rejects.toThrow();
  });

  // MySQL refuses to rename a column a check names, so the old check comes off before the rename.
  it('should rename a column under its check through a generated migration, and back', async () => {
    const migrator = await migratorWithFiles();
    redeclare('status', { name: 'state' });

    await migrator.generateFromEntities('rename_status');
    expect(await migrator.up()).toMatchObject([{ success: true }]);
    await expect(insert({ status: 'void' })).rejects.toThrow();
    expect(await migrator.down()).toMatchObject([{ success: true }]);
  });

  // SQLite adds the declared check by rebuilding the table, which has to carry this one along.
  it('should leave a check uql did not install, and warn about it beside the ones it declares', async () => {
    await dropTables(pool, 'CkHand');
    const id = (name: string) => pool.dialect.escapeId(name);
    await pool.run(
      `CREATE TABLE ${id('CkHand')} (${id('id')} BIGINT PRIMARY KEY, ${id('n')} BIGINT, CONSTRAINT hand_ck CHECK (n >= 0))`,
    );
    const migrator = new Migrator(pool, { entities: [CkHand] });
    const warn = vi.spyOn(migrator.logger, 'logWarn');

    await migrator.sync({ safe: false, logging: false });

    expect(await installed('CkHand')).toEqual([expect.stringMatching(/^_uql_CkHand__ck_[0-9a-f]{6}$/), 'hand_ck']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hand_ck'));
  });
});
