import { expect, onTestFinished } from 'bun:test';
import { SqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { createSpec, User } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'postgres://test:test@0.0.0.0:5442/test_bun_pg';
const pool = new BunSqlQuerierPool({ url });

class BunPostgresIt extends PostgresQuerierIt {
  /** `bun:sql` has no cursor API, so `findManyStream` declares one in SQL, which `pg_cursors` lists while it reads. */
  async shouldPageTheRowsThroughACursorAndLeaveNoneBehind() {
    const querier = await pool.getQuerier();
    onTestFinished(() => querier.release());
    await querier.insertMany(User, [
      { name: 'Alice', email: 'alice@cursor.com' },
      { name: 'Bob', email: 'bob@cursor.com' },
    ]);

    const openWhileStreaming: number[] = [];
    for await (const _row of querier.findManyStream(User, { $sort: { name: 1 } })) {
      openWhileStreaming.push(await countCursors(querier));
    }

    expect(openWhileStreaming).toEqual([1, 1]);
    expect(await countCursors(querier)).toBe(0);
  }

  /** `pool.pool` answers as a `pg` pool does, for libraries like connect-pg-simple, a wide integer exactly. */
  async shouldAnswerAsAPgPool() {
    expect(await pool.pool.query('SELECT $1::int8 AS big', ['9007199254740993'])).toEqual({
      rows: [{ big: '9007199254740993' }],
      rowCount: 1,
    });
    expect(await pool.pool.query('SELECT 1 WHERE false')).toEqual({ rows: [], rowCount: 0 });
  }
}

createSpec(new BunPostgresIt(pool));
createSpec(new SqlQuerierPoolIt(() => new BunSqlQuerierPool({ url })));

/** On the connection itself, as the cursor's own statements run: `pg_cursors` lists this session's only, and the querier refuses a statement mid-stream. */
async function countCursors(querier: BunSqlQuerier) {
  const [row] = await querier.internalAll<{ n: number }>('SELECT count(*)::int AS n FROM pg_cursors');
  return row.n;
}
