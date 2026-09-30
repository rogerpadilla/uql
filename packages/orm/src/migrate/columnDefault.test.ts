// A column default on every SQL engine, as a literal or as SQL, from the entity through the database and
// back: what fills a row, what introspection reads, what drift compares and what a `down` puts back.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { Entity, Field, Id, removeEntity } from '../entity/index.js';
import { SqlExpression } from '../schema/sqlExpression.js';
import { provisioningTimeout } from '../test/index.js';
import { dropTables, sqlPools } from '../test/sqlPools.js';
import type { SqlQuerierPool } from '../type/index.js';
import { currentTimestamp, raw } from '../util/raw.js';
import { expr } from './builder/expressions.js';
import { introspectorFor } from './introspection/registry.js';
import { Migrator } from './migrator.js';

const DEFAULT_POOLS = sqlPools('test_default');

@Entity({ name: 'DefaultNote' })
class DefaultNote {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  /** Text that spells the clock, which is text all the same. */
  @Field({ type: String, defaultValue: 'CURRENT_TIMESTAMP' }) spelled?: string | null;
  @Field({ type: Date, defaultValue: currentTimestamp }) createdAt?: Date | null;
  @Field({ type: String, defaultValue: raw`coalesce(NULL, 'a')` }) derived?: string | null;
}

describe.each(DEFAULT_POOLS)('a column default on %s', (_name, connect) => {
  let pool: SqlQuerierPool;
  const escapeId = (name: string) => pool.dialect.escapeId(name);
  const tables = ['DefaultNote', 'DefaultDown'] as const;

  beforeAll(async () => {
    pool = connect();
    await dropTables(pool, ...tables);
    await new Migrator(pool, { entities: [DefaultNote] }).sync({ logging: false });
  }, provisioningTimeout);

  afterAll(async () => {
    await dropTables(pool, ...tables);
    await pool.end();
  }, provisioningTimeout);

  it('should fill a literal as its text and SQL as what it evaluates to', async () => {
    const id = await pool.insertOne(DefaultNote, { body: 'filled' });
    const [row] = await pool.findMany(DefaultNote, { $where: { id } });

    expect(row.spelled).toBe('CURRENT_TIMESTAMP');
    expect(Math.abs(Number(row.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(row.derived).toBe('a');
    // The clock in the text and digits a bound `Date` takes, so the row matches itself read back.
    expect(await pool.count(DefaultNote, { $where: { id, createdAt: row.createdAt } })).toBe(1);
  });

  it('should read each default back as what it is, and so find nothing to change', async () => {
    const schema = await introspectorFor(pool).getTableSchema('DefaultNote');
    const defaultOf = (name: string) => schema?.columns.find((column) => column.name === name)?.defaultValue;

    expect(defaultOf('spelled')).toBe('CURRENT_TIMESTAMP');
    expect(defaultOf('createdAt')).toEqual(expr.now());
    expect(defaultOf('derived')).toBeInstanceOf(SqlExpression);
    // Unsafe, which is what plans an alter: a safe plan holds every one, a changed default included.
    expect(await new Migrator(pool, { entities: [DefaultNote] }).planSync({ safe: false })).toEqual([]);
  });

  /** A `down` restores a column from what the database reported, so an SQL default has to come back as SQL. */
  it("should put an SQL default back as SQL through a generated migration's down", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uql-default-'));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));

    @Entity({ name: 'DefaultDown' })
    class Full {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) body?: string | null;
      @Field({ type: Date, defaultValue: currentTimestamp }) createdAt?: Date | null;
      @Field({ type: String, defaultValue: raw`coalesce(NULL, 'a')` }) derived?: string | null;
    }
    await new Migrator(pool, { entities: [Full] }).sync({ logging: false });
    removeEntity(Full);

    @Entity({ name: 'DefaultDown' })
    class Slim {
      @Id({ type: Number }) id?: number;
      @Field({ type: String }) body?: string | null;
    }
    onTestFinished(() => {
      removeEntity(Slim);
    });
    const migrator = new Migrator(pool, { entities: [Slim], migrationsPath: dir });
    await migrator.generateFromEntities('drop_defaults');
    await migrator.up();
    await migrator.down();

    const id = await pool.insertOne(Slim, { body: 'restored' });
    const [row] = await pool.all<{ createdAt: unknown; derived: string }>(
      `SELECT ${escapeId('createdAt')}, ${escapeId('derived')} FROM ${escapeId('DefaultDown')} WHERE ${escapeId('id')} = ${id}`,
    );
    expect(row.createdAt).not.toBeNull();
    expect(row.derived).toBe('a');
  });
});

afterAll(() => {
  removeEntity(DefaultNote);
});
