// A stamp on every engine, each written by a trigger. The point of the feature is the write uql did not
// make: each test updates through raw SQL.

import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { assertDefined } from '../test/index.js';
import { sqlPools, syncedPool } from '../test/sqlPools.js';
import type { PrimaryKey } from '../type/index.js';
import { currentTimestamp, raw } from '../util/raw.js';
import { Migrator } from './migrator.js';

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

/** A code held as text, which a test retypes. */
@Entity({ name: 'StampRetyped' })
class StampCoded {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) code?: string | null;
  @Field({ type: Number, computed: raw`1`, stored: ['update'] }) readonly touched?: number | null;
}

describe.each(sqlPools('test_stamp'))('a stamp on %s', (_name, connect) => {
  const pool = syncedPool(connect, [StampNote, StampTouch, StampClocks, StampCoded]);

  /** Sets `column` of the row `id` in `table` to the SQL `value`, a write uql does not make. */
  const updateAround = (table: string, column: string, value: string, id: PrimaryKey | undefined) => {
    assertDefined(id);
    const escapeId = (name: string) => pool().dialect.escapeId(name);
    return pool()
      .run`UPDATE ${raw.text(escapeId(table))} SET ${raw.text(escapeId(column))} = ${raw.text(value)} WHERE ${raw.text(escapeId('id'))} = ${id}`;
  };

  // `onUpdate` would stamp only what uql writes; this write goes around it entirely.
  it('should be written by the database on a write uql did not make', async () => {
    const id = await pool().insertOne(StampNote, { body: 'first' });
    await updateAround('StampNote', 'body', "'raw'", id);
    expect(await pool().findOneById(StampNote, id, { $select: { touched: true } })).toEqual({ touched: 1 });
  });

  // The database's clock in the text and digits a bound `Date` takes: the stamp is now, and matches itself read back.
  it('should stamp the time as the value it reads back as', async () => {
    const id = await pool().insertOne(StampNote, { body: 'timed' });
    const [row] = await pool().findMany(StampNote, { $select: { stampedAt: true }, $where: { id } });
    expect(Math.abs(Number(row.stampedAt) - Date.now())).toBeLessThan(60_000);
    expect(await pool().count(StampNote, { $where: { id, stampedAt: row.stampedAt } })).toBe(1);
  });

  // SQL Server reads its clock per statement, so a clock stamp restating its row always moves the other's.
  it('should stamp two clocks on one update, neither firing the other without end', async () => {
    const id = await pool().insertOne(StampClocks, { body: 'first' });
    await updateAround('StampClocks', 'body', "'raw'", id);
    expect(await pool().count(StampClocks, { $where: { id, editedAt: { $ne: null }, savedAt: { $ne: null } } })).toBe(
      1,
    );
  });

  // The line between the two: `onUpdate` puts the expression in uql's own statement and nowhere else.
  it('should stamp an onUpdate field from the database, on a write uql makes', async () => {
    const id = await pool().insertOne(StampTouch, { body: 'first' });
    await pool().updateOneById(StampTouch, id, { body: 'second' });
    expect(await pool().findOneById(StampTouch, id, { $select: { touched: true } })).toEqual({ touched: 1 });
  });

  it('should leave an onUpdate field alone on a write uql did not make', async () => {
    const id = await pool().insertOne(StampTouch, { body: 'first' });
    await updateAround('StampTouch', 'body', "'raw'", id);
    expect(await pool().findOneById(StampTouch, id, { $select: { touched: true } })).toEqual({ touched: null });
  });

  // SQL Server reads a written id back through `OUTPUT`, which a table carrying a trigger only allows `INTO` a
  // table, on either path of an upsert.
  it('should upsert on a table carrying a trigger, inserting and then updating', async () => {
    const id = 1_000_000;
    await pool().upsertOne(StampNote, { id: true }, { id, body: 'inserted' });
    const inserted = await pool().findOneById(StampNote, id, { $select: { body: true, touched: true } });
    await pool().upsertOne(StampNote, { id: true }, { id, body: 'updated' });
    const updated = await pool().findOneById(StampNote, id, { $select: { body: true } });
    expect([inserted, updated]).toEqual([{ body: 'inserted', touched: 1 }, { body: 'updated' }]);
  });

  /** A retype SQLite makes by rebuilding the table, which drops its triggers, so they have to come back on. */
  it('should still stamp once its table is retyped', async () => {
    @Entity({ name: 'StampRetyped' })
    class Retyped {
      @Id({ type: Number }) id?: number;
      @Field({ type: Number }) code?: number | null;
      @Field({ type: Number, computed: raw`1`, stored: ['update'] }) readonly touched?: number | null;
    }
    const id = await pool().insertOne(StampCoded, { code: '1' });
    const migrator = new Migrator(pool(), { entities: [Retyped] });

    await migrator.sync({ safe: false });
    await updateAround('StampRetyped', 'code', '2', id);

    expect(await pool().findOneById(Retyped, id, { $select: { touched: true } })).toEqual({ touched: 1 });
    expect(await migrator.planSync({ safe: false })).toEqual([]);
  });

  it('should not take a value from a payload, the database owning it', async () => {
    // @ts-expect-error a stamp is the database's to write, so a payload naming it does not compile
    const id = await pool().insertOne(StampNote, { body: 'x', touched: 9 });
    expect(await pool().findOneById(StampNote, id, { $select: { touched: true } })).toEqual({ touched: 1 });
  });
});
