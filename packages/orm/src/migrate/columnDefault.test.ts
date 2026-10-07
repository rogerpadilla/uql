// A column default on every SQL engine, as a literal or as SQL, from the entity through the database and
// back: what fills a row, what introspection reads, what drift compares and what a `down` puts back.

import { describe, expect, it } from 'vitest';
import { Entity, Field, Id } from '../entity/index.js';
import { SqlExpression } from '../schema/sqlExpression.js';
import { migrationsDir } from '../test/index.js';
import { sqlPools, syncedPool } from '../test/sqlPools.js';
import type { Json } from '../type/index.js';
import { currentTimestamp, raw } from '../util/raw.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

@Entity({ name: 'DefaultNote' })
class DefaultNote {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  /** Text that spells the clock, which is text all the same. */
  @Field({ type: String, defaultValue: 'CURRENT_TIMESTAMP' }) spelled?: string | null;
  @Field({ type: Date, defaultValue: currentTimestamp }) createdAt?: Date | null;
  @Field({ type: String, defaultValue: raw`coalesce(NULL, 'a')` }) derived?: string | null;
  @Field({ type: 'jsonb', defaultValue: [] }) tags?: Json<string[]> | null;
  /** Keys in another order, and spacing, than Postgres keeps them. */
  @Field({ type: 'jsonb', defaultValue: { b: 1, a: [1, 2] } }) settings?: Json<{ a: number[]; b: number }> | null;
  /** The same, as the text the column stores. */
  @Field({ type: 'jsonb', defaultValue: '{"b":1,"a":2}' }) written?: Json<{ a: number; b: number }> | null;
}

/** The SQL defaults alone, on a table a test drops them from. */
@Entity({ name: 'DefaultDown' })
class DefaultDown {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: Date, defaultValue: currentTimestamp }) createdAt?: Date | null;
  @Field({ type: String, defaultValue: raw`coalesce(NULL, 'a')` }) derived?: string | null;
}

describe.each(sqlPools('test_default'))('a column default on %s', (_name, connect) => {
  const pool = syncedPool(connect, [DefaultNote, DefaultDown]);

  it('should fill a literal as its text and SQL as what it evaluates to', async () => {
    const id = await pool().insertOne(DefaultNote, { body: 'filled' });
    const [row] = await pool().findMany(DefaultNote, { $where: { id } });

    expect(row.spelled).toBe('CURRENT_TIMESTAMP');
    expect(Math.abs(Number(row.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(row.derived).toBe('a');
    expect([row.tags, row.settings, row.written]).toEqual([[], { a: [1, 2], b: 1 }, { a: 2, b: 1 }]);
    // The clock in the text and digits a bound `Date` takes, so the row matches itself read back.
    expect(await pool().count(DefaultNote, { $where: { id, createdAt: row.createdAt } })).toBe(1);
  });

  it('should read each default back as what it is, and so find nothing to change', async () => {
    const schema = await introspectorFor(pool()).getTableSchema('DefaultNote');
    const defaultOf = (name: string) => schema?.columns.find((column) => column.name === name)?.defaultValue;

    expect(defaultOf('spelled')).toBe('CURRENT_TIMESTAMP');
    expect(defaultOf('createdAt')).toEqual(new SqlExpression('currentTimestamp'));
    expect(defaultOf('derived')).toBeInstanceOf(SqlExpression);
    // Unsafe, which is what plans an alter: a safe plan holds every one, a changed default included.
    expect(await new Migrator(pool(), { entities: [DefaultNote] }).planSync({ safe: false })).toEqual([]);
  });

  /** A `down` restores a column from what the database reported, so an SQL default has to come back as SQL. */
  it("should put an SQL default back as SQL through a generated migration's down", async () => {
    @Entity({ name: 'DefaultDown' })
    class Slim {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) body?: string | null;
    }
    const migrator = new Migrator(pool(), { entities: [Slim], migrationsPath: await migrationsDir() });

    await migrator.generateFromEntities('drop_defaults');
    expect(await migrator.up()).toMatchObject([{ success: true }]);
    expect(await migrator.down()).toMatchObject([{ success: true }]);

    const id = await pool().insertOne(Slim, { body: 'restored' });
    const [row] = await pool().findMany(DefaultDown, { $select: { createdAt: true, derived: true }, $where: { id } });
    expect(Math.abs(Number(row.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(row.derived).toBe('a');
  });
});
