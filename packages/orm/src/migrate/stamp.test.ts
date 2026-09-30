// A stamp on every engine, each written by a trigger. The point of the feature is the write uql did not
// make: each test updates through raw SQL.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, removeEntity } from '../entity/index.js';
import { provisioningTimeout } from '../test/index.js';
import { dropTables, sqlPools } from '../test/sqlPools.js';
import type { SqlQuerierPool } from '../type/index.js';
import { currentTimestamp, raw } from '../util/raw.js';
import { Migrator } from './migrator.js';

const STAMP_POOLS = sqlPools('test_stamp', 'pglite');

/** What `onUpdate` already does: the database computes it, but only in the statement uql emits. */
@Entity({ name: 'StampTouch' })
class StampTouch {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: Number, onUpdate: raw`1` }) touched?: number | null;
}

@Entity({ name: 'StampNote' })
class StampNote {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: Number, computed: raw`1`, stored: ['insert', 'update'] }) readonly touched?: number | null;
  @Field({ type: Date, computed: currentTimestamp, stored: ['insert', 'update'] }) readonly stampedAt?: Date | null;
}

@Entity({ name: 'StampClocks' })
class StampClocks {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: Date, computed: currentTimestamp, stored: ['update'] }) readonly editedAt?: Date | null;
  @Field({ type: Date, computed: currentTimestamp, stored: ['update'] }) readonly savedAt?: Date | null;
}

describe.each(STAMP_POOLS)('a stamp on %s', (_name, connect) => {
  let pool: SqlQuerierPool;
  const escapeId = (name: string) => pool.dialect.escapeId(name);

  const tables = ['StampNote', 'StampTouch', 'StampClocks', 'StampRetyped'] as const;

  beforeAll(async () => {
    pool = connect();
    await dropTables(pool, ...tables);
    await new Migrator(pool, { entities: [StampNote, StampTouch, StampClocks] }).sync({ logging: false });
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, ...tables);
    await pool.end();
  }, provisioningTimeout);

  // `onUpdate` would stamp only what uql writes; this write goes around it entirely.
  it('should be written by the database on a write uql did not make', async () => {
    const inserted = await pool.insertOne(StampNote, { body: 'first' });
    await pool.run(
      `UPDATE ${escapeId('StampNote')} SET ${escapeId('body')} = 'raw' WHERE ${escapeId('id')} = ${inserted}`,
    );
    const [row] = await pool.all<{ touched: number }>(
      `SELECT ${escapeId('touched')} FROM ${escapeId('StampNote')} WHERE ${escapeId('id')} = ${inserted}`,
    );
    expect(Number(row.touched)).toBe(1);
  });

  // The database's clock in the text and digits a bound `Date` takes: the stamp is now, and matches itself read back.
  it('should stamp the time as the value it reads back as', async () => {
    const id = await pool.insertOne(StampNote, { body: 'timed' });
    const [row] = await pool.findMany(StampNote, { $select: { stampedAt: true }, $where: { id } });
    expect(Math.abs(Number(row.stampedAt) - Date.now())).toBeLessThan(60_000);
    expect(await pool.count(StampNote, { $where: { id, stampedAt: row.stampedAt } })).toBe(1);
  });

  // SQL Server reads its clock per statement, so a clock stamp restating its row always moves the other's.
  it('should stamp two clocks on one update, neither firing the other without end', async () => {
    const id = await pool.insertOne(StampClocks, { body: 'first' });
    await pool.run(`UPDATE ${escapeId('StampClocks')} SET ${escapeId('body')} = 'raw' WHERE ${escapeId('id')} = ${id}`);
    expect(await pool.count(StampClocks, { $where: { id, editedAt: { $ne: null }, savedAt: { $ne: null } } })).toBe(1);
  });

  // The line between the two: `onUpdate` puts the expression in uql's own statement and nowhere else.
  it('should stamp an onUpdate field from the database, on a write uql makes', async () => {
    const id = await pool.insertOne(StampTouch, { body: 'first' });
    await pool.updateOneById(StampTouch, id, { body: 'second' });
    const [row] = await pool.all<{ touched: number }>(
      `SELECT ${escapeId('touched')} FROM ${escapeId('StampTouch')} WHERE ${escapeId('id')} = ${id}`,
    );
    expect(Number(row.touched)).toBe(1);
  });

  it('should leave an onUpdate field alone on a write uql did not make', async () => {
    const id = await pool.insertOne(StampTouch, { body: 'first' });
    await pool.run(`UPDATE ${escapeId('StampTouch')} SET ${escapeId('body')} = 'raw' WHERE ${escapeId('id')} = ${id}`);
    const [row] = await pool.all<{ touched: number | null }>(
      `SELECT ${escapeId('touched')} FROM ${escapeId('StampTouch')} WHERE ${escapeId('id')} = ${id}`,
    );
    expect(row.touched == null).toBe(true);
  });

  // SQL Server reads generated ids back through `OUTPUT`, which a table carrying a trigger only allows
  // `INTO` a table: every write here has one on insert, several rows and an upsert included.
  it('should hand back the id of every row it inserts, the table carrying a trigger', async () => {
    const ids = await pool.insertMany(StampNote, [{ body: 'a' }, { body: 'b' }, { body: 'c' }]);
    const rows = await pool.findMany(StampNote, { $select: { id: true, body: true }, $where: { id: { $in: ids } } });
    expect(rows.map((row) => row.body).toSorted()).toEqual(['a', 'b', 'c']);
  });

  it('should upsert on a table carrying a trigger, inserting and then updating', async () => {
    const id = await pool.insertOne(StampNote, { body: 'before' });
    await pool.upsertOne(StampNote, { id: true }, { id, body: 'after' });
    const [row] = await pool.all<{ body: string }>(
      `SELECT ${escapeId('body')} FROM ${escapeId('StampNote')} WHERE ${escapeId('id')} = ${id}`,
    );
    expect(row.body).toBe('after');
  });

  /** A retype SQLite makes by rebuilding the table, which drops its triggers, so they have to come back on. */
  it('should still stamp once its table is retyped', async () => {
    @Entity({ name: 'StampRetyped' })
    class Before {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) code?: string | null;
      @Field({ type: Number, computed: raw`1`, stored: ['update'] }) readonly touched?: number | null;
    }
    await new Migrator(pool, { entities: [Before] }).sync({ logging: false });
    const id = await pool.insertOne(Before, { code: '1' });
    removeEntity(Before);

    @Entity({ name: 'StampRetyped' })
    class After {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) code?: number | null;
      @Field({ type: Number, computed: raw`1`, stored: ['update'] }) readonly touched?: number | null;
    }
    const migrator = new Migrator(pool, { entities: [After] });
    await migrator.sync({ logging: false, safe: false });
    await pool.run(`UPDATE ${escapeId('StampRetyped')} SET ${escapeId('code')} = 2 WHERE ${escapeId('id')} = ${id}`);

    const [row] = await pool.all<{ touched: number }>(
      `SELECT ${escapeId('touched')} FROM ${escapeId('StampRetyped')} WHERE ${escapeId('id')} = ${id}`,
    );
    expect(Number(row.touched)).toBe(1);
    expect(await migrator.planSync({ safe: false })).toEqual([]);
    removeEntity(After);
  });

  it('should not take a value from a payload, the database owning it', async () => {
    // @ts-expect-error a stamp is the database's to write, so a payload naming it does not compile
    const written = await pool.insertOne(StampNote, { body: 'x', touched: 9 });
    const [row] = await pool.all<{ touched: number }>(
      `SELECT ${escapeId('touched')} FROM ${escapeId('StampNote')} WHERE ${escapeId('id')} = ${written}`,
    );
    expect(Number(row.touched)).toBe(1);
  });
});

afterAll(() => {
  removeEntity(StampNote);
  removeEntity(StampTouch);
  removeEntity(StampClocks);
});
