// An entity with no key, as a view or a log often is, on every engine: read like any other, never written.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BeforeInsert, Entity, f, Field } from '../entity/index.js';
import { MongodbQuerierPool } from '../mongodb/mongodbQuerierPool.js';
import { mongoUri } from '../test/connections.js';
import { sqlPools, syncedPool } from '../test/sqlPools.js';
import type { UniversalQuerier } from '../type/index.js';
import { sql } from '../util/sql.js';

/** The hooks a refused write must never reach. */
const fired: string[] = [];

@Entity({ name: 'KeylessReading' })
class Reading {
  @Field(f.string()) sensor!: string;
  @Field(f.number()) value!: number;

  @BeforeInsert()
  mark() {
    fired.push('beforeInsert');
  }
}

const READ_ONLY = "'Reading' has no primary key, so it is read-only";

/** The cases every engine holds, on a pool whose table holds a row `a` of 1 and a row `b` of 2. */
function itReadsAndRefusesWrites(pool: () => UniversalQuerier) {
  it('should read like any other entity', async () => {
    const sorted = { $select: { sensor: true, value: true }, $sort: { sensor: 'asc' } } as const;

    expect(await pool().findMany(Reading, sorted)).toEqual([
      { sensor: 'a', value: 1 },
      { sensor: 'b', value: 2 },
    ]);
    expect(await pool().findOne(Reading, { ...sorted, $where: { sensor: 'b' } })).toEqual({ sensor: 'b', value: 2 });
    expect(await pool().findMany(Reading, { $sort: { sensor: 'asc' } })).toEqual([
      { sensor: 'a', value: 1 },
      { sensor: 'b', value: 2 },
    ]);
    expect(await pool().count(Reading)).toBe(2);
    expect(await pool().exists(Reading, { $where: { value: { $gt: 1 } } })).toBe(true);
    expect(await pool().aggregate(Reading, { $select: { total: { $sum: { value: true } } } })).toEqual([{ total: 3 }]);
    expect(await Array.fromAsync(pool().findManyStream(Reading, sorted))).toEqual([
      { sensor: 'a', value: 1 },
      { sensor: 'b', value: 2 },
    ]);
  });

  it('should refuse every write by name, before any hook runs', async () => {
    const row = { sensor: 'c', value: 3 };

    await expect(pool().insertOne(Reading, row)).rejects.toThrow(READ_ONLY);
    await expect(pool().insertMany(Reading, [row])).rejects.toThrow(READ_ONLY);
    await expect(pool().saveOne(Reading, row)).rejects.toThrow(READ_ONLY);
    await expect(pool().upsertOne(Reading, { $conflict: { sensor: true } }, row)).rejects.toThrow(READ_ONLY);
    await expect(pool().updateMany(Reading, { $where: { sensor: 'a' } }, { value: 9 })).rejects.toThrow(READ_ONLY);
    await expect(pool().deleteMany(Reading, { $where: { sensor: 'a' } })).rejects.toThrow(READ_ONLY);
    expect(fired).toEqual([]);
    expect(await pool().count(Reading)).toBe(2);
  });

  it('should refuse a read by key, which it has none of', async () => {
    await expect(pool().findOneById(Reading, 'a')).rejects.toThrow("'Reading' has no primary key");
  });
}

describe.each(sqlPools('test_keyless'))('a keyless entity on %s', (_name, connect) => {
  const pool = syncedPool(connect, [Reading]);

  beforeAll(async () => {
    const { dialect } = pool();
    await pool().run(
      sql.text(
        `INSERT INTO ${dialect.escapeId('KeylessReading')} (${dialect.escapeId('sensor')}, ${dialect.escapeId('value')}) ` +
          "VALUES ('a', 1), ('b', 2)",
      ),
    );
  });

  itReadsAndRefusesWrites(pool);
});

describe('a keyless entity on MongoDB', () => {
  const pool = new MongodbQuerierPool(mongoUri('uql_keyless'));

  beforeAll(async () => {
    await pool.withQuerier(async ({ db }) => {
      await db.collection('KeylessReading').deleteMany({});
      await db.collection('KeylessReading').insertMany([
        { sensor: 'a', value: 1 },
        { sensor: 'b', value: 2 },
      ]);
    });
  });
  afterAll(() => pool.end());

  itReadsAndRefusesWrites(() => pool);
});
