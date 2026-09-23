// What only SQLite can ask: a stamp restates the row with an `UPDATE` after the write, since SQLite cannot
// assign to `NEW`, and that `UPDATE` fires the same trigger. With `recursive_triggers` on, it has to stop
// itself rather than recurse until SQLite's depth limit refuses the write.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity, Field, Id, removeEntity } from '../entity/index.js';
import { Migrator } from '../migrate/migrator.js';
import { raw } from '../util/raw.js';
import { NodeSqliteQuerierPool } from './nodeSqliteQuerierPool.js';

@Entity({ name: 'RecursiveStamp' })
class RecursiveStamp {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) body?: string | null;
  @Field({ type: Number, computed: raw`1`, stored: ['update'] }) readonly touched?: number | null;
}

describe('a stamp on SQLite with recursive triggers on', () => {
  let pool: NodeSqliteQuerierPool;

  beforeAll(async () => {
    pool = new NodeSqliteQuerierPool(':memory:');
    await new Migrator(pool, { entities: [RecursiveStamp] }).sync({ logging: false });
    await pool.run('PRAGMA recursive_triggers = ON');
  });

  afterAll(async () => {
    await pool.end();
    removeEntity(RecursiveStamp);
  });

  it('should stamp once, its own restatement finding nothing left to change', async () => {
    const id = await pool.insertOne(RecursiveStamp, { body: 'first' });
    await pool.updateOneById(RecursiveStamp, id, { body: 'second' });
    expect(await pool.findMany(RecursiveStamp, { $select: { touched: true }, $where: { id } })).toEqual([
      { touched: 1 },
    ]);
  });
});
