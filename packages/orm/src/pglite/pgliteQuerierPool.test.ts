import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { defineEntity, f, getMeta } from '../entity/index.js';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { createSpec } from '../test/index.js';
import type { TransactionOptions } from '../type/index.js';
import { sql } from '../util/sql.js';
import { PgliteQuerierPool } from './pgliteQuerierPool.js';

createSpec(new SqlQuerierPoolIt(() => new PgliteQuerierPool('memory://')));

const Tag = defineEntity({ name: 'tag', fields: { id: f.number().autoIncrement(), name: f.string().nullable() } });

/** A handle the caller opened and keeps using itself, as live queries, a sync engine or another tab do. */
describe('a PGlite handle the caller shares', () => {
  it('should keep a statement sent to the handle out of the transaction it waits for', async () => {
    const db = await PGlite.create('memory://');
    const pool = new PgliteQuerierPool(async () => db);
    await db.query('CREATE TABLE tag (name TEXT)');
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: left, resolve: leave } = Promise.withResolvers<void>();

    const transaction = pool.transaction(async (querier) => {
      await querier.run`INSERT INTO tag VALUES ('undone')`;
      enter();
      await left;
      throw new Error('undo');
    });
    await entered;
    const outside = db.query(`INSERT INTO tag VALUES ('kept')`);
    leave();

    await expect(transaction).rejects.toThrow('undo');
    await outside;
    expect((await db.query('SELECT name FROM tag')).rows).toEqual([{ name: 'kept' }]);
    await pool.end();
  });

  it('should stream outside a transaction without opening one another caller could write into', async () => {
    const db = await PGlite.create('memory://');
    const pool = new PgliteQuerierPool(async () => db);
    await db.query('CREATE TABLE tag (id BIGSERIAL PRIMARY KEY, name TEXT)');
    await db.query(`INSERT INTO tag (name) VALUES ('a')`);
    const querier = await pool.getQuerier();
    const open: unknown[] = [];

    for await (const _row of querier.findManyStream(Tag, { $select: { id: true } })) {
      open.push(...(await db.query("SELECT count(*)::int AS cursors FROM pg_cursors WHERE name LIKE '_uql%'")).rows);
    }

    expect(open).toEqual([{ cursors: 0 }]);
    await querier.release();
    await pool.end();
  });

  /** Options as an untyped caller hands them, naming a level Postgres does not have. */
  it('should free the handle when the transaction it opened cannot take its modes', async () => {
    const pool = new PgliteQuerierPool(() => PGlite.create('memory://'));
    const opts: TransactionOptions = JSON.parse('{ "isolationLevel": "snapshot" }');

    await expect(pool.transaction(async () => {}, opts)).rejects.toThrow('syntax error');

    await expect(pool.all`SELECT 1 AS one`).resolves.toEqual([{ one: 1 }]);
    await pool.end();
  });

  it('should run a second querier of the flow inside its transaction', async () => {
    const db = await PGlite.create('memory://');
    const pool = new PgliteQuerierPool(async () => db);
    await db.query('CREATE TABLE tag (name TEXT)');

    const transaction = pool.transaction(async () => {
      const other = await pool.getQuerier();
      await other.run`INSERT INTO tag VALUES ('undone')`;
      await other.release();
      throw new Error('undo');
    });

    await expect(transaction).rejects.toThrow('undo');
    expect((await db.query('SELECT name FROM tag')).rows).toEqual([]);
    await pool.end();
  });

  it('should decode its rows as every Postgres-wire pool does', async () => {
    const db = await PGlite.create('memory://');
    const pool = new PgliteQuerierPool(async () => db);
    const read = sql.text(`SELECT 9007199254740993::int8 AS wide, ARRAY[9007199254740993::int8] AS wides,
      ARRAY['2026-09-10'::date] AS days, '2026-09-10 12:30:00'::timestamp AS stamp`);

    const [row] = await pool.all(read);

    expect(row).toEqual({
      wide: '9007199254740993',
      wides: ['9007199254740993'],
      days: [new Date('2026-09-10T00:00:00.000Z')],
      stamp: new Date('2026-09-10T12:30:00.000Z'),
    });
    await pool.end();
  });

  it('should take its options second, the handle being configured where it is opened', async () => {
    const pool = new PgliteQuerierPool(() => PGlite.create('memory://'), { schema: 'tenant' });

    expect(pool.extra).toEqual({ schema: 'tenant' });
    expect(pool.dialect.escapedTableName(getMeta(Tag))).toBe('"tenant"."tag"');
    await pool.end();
  });

  it('should leave the handle decoding as its owner set it', async () => {
    const db = await PGlite.create('memory://');
    const pool = new PgliteQuerierPool(async () => db);
    await pool.all`SELECT 1`;

    const { rows } = await db.query('SELECT 9007199254740993::int8 AS wide');

    expect(rows).toEqual([{ wide: 9007199254740993n }]);
    await pool.end();
  });
});
