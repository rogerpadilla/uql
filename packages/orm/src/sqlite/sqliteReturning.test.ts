// What `returning` costs a write where the engine has `RETURNING`: its own statement reports each row it wrote, and
// only a row an upsert kept is read after. A stamp restates its row after the write, which `RETURNING` misses.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Computed, Entity, f, Field } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { sql } from '../util/sql.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';

@Entity()
class Counter {
  @Field(f.number().id()) id?: number;
  @Field(f.string().unique()) key!: string;
  @Field(f.number()) hits!: number;
}

@Entity()
class Stamped {
  @Field(f.number().id()) id?: number;
  @Field(f.string().unique()) key!: string;
  @Field(f.string()) body!: string;
  @Computed(() =>
    f
      .number()
      .nullable()
      .as(sql`random()`)
      .stored(['insert', 'update']),
  )
  readonly stamp?: number | null;
}

describe('a write returning on SQLite', () => {
  const statements: string[] = [];
  let pool: NodeSqliteQuerierPool;

  beforeAll(async () => {
    pool = new NodeSqliteQuerierPool(':memory:', {}, { logger: { logQuery: (sql) => statements.push(sql) } });
    await new Migrator(pool, { entities: [Counter, Stamped] }).sync();
    await pool.insertOne(Counter, { key: 'seen', hits: 1 });
  });

  beforeEach(() => {
    statements.length = 0;
  });

  afterAll(() => pool.end());

  it('should insert rows and report them in one statement', async () => {
    const rows = await pool.insertMany(
      Counter,
      [
        { key: 'first', hits: 1 },
        { key: 'second', hits: 2 },
      ],
      { returning: { key: true, hits: true } },
    );

    expect(rows).toEqual([
      { key: 'first', hits: 1 },
      { key: 'second', hits: 2 },
    ]);
    expect(statements).toHaveLength(1);
  });

  it('should count a hit and report it in one statement', async () => {
    const counted = await pool.upsertOne(
      Counter,
      { $conflict: { key: true } },
      { key: 'seen', hits: 1 },
      { hits: { $inc: 1 } },
      { returning: { hits: true } },
    );

    expect(counted).toEqual({ hits: 2 });
    expect(statements).toHaveLength(1);
  });

  it('should read only a row its $where kept', async () => {
    const rows = await pool.upsertMany(
      Counter,
      { $conflict: { key: true }, $where: { hits: { $gt: 100 } } },
      [
        { key: 'seen', hits: 1 },
        { key: 'new', hits: 1 },
      ],
      { hits: 0 },
      { returning: { key: true, hits: true } },
    );

    expect(rows).toEqual([
      { key: 'seen', hits: 2 },
      { key: 'new', hits: 1 },
    ]);
    expect(statements).toHaveLength(2);
  });

  it('should read back a row its stamp restates, inserted or updated', async () => {
    const stamped = (key: string) => pool.findMany(Stamped, { $select: { stamp: true }, $where: { key } });
    const inserted = await pool.insertMany(Stamped, [{ key: 'b', body: 'abc' }], { returning: { stamp: true } });
    expect(inserted).toEqual(await stamped('b'));

    const upserted = await pool.upsertMany(
      Stamped,
      { $conflict: { key: true } },
      [{ key: 'a', body: 'abc' }],
      undefined,
      { returning: { stamp: true } },
    );
    expect(upserted).toEqual(await stamped('a'));

    const updated = await pool.updateMany(
      Stamped,
      { $where: { key: 'a' } },
      { body: 'abcdef' },
      { returning: { stamp: true } },
    );
    expect(updated).toEqual(await stamped('a'));
  });
});
