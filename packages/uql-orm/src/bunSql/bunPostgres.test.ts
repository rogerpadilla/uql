import { describe, expect, it } from 'vitest';
import { AbstractSqlQuerierPoolIt } from '../querier/abstractSqlQuerierPool-test.js';
import { PostgresQuerierIt } from '../querier/postgresQuerier-test.js';
import { User, createSpec, createTables, dropTables } from '../test/index.js';
import type { BunSqlQuerier } from './bunSqlQuerier.js';
import { BunSqlQuerierPool } from './bunSqlQuerierPool.js';

const url = 'postgres://test:test@0.0.0.0:5442/test_bun_pg';

class BunPostgresIt extends PostgresQuerierIt {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

class BunPostgresPoolIt extends AbstractSqlQuerierPoolIt<BunSqlQuerier> {
  constructor() {
    super(new BunSqlQuerierPool({ url }));
  }
}

createSpec(new BunPostgresIt());
createSpec(new BunPostgresPoolIt());

/** `bun:sql` has no cursor API, so `findManyStream` declares one in SQL. `pg_cursors` sees it or it did not happen. */
describe('server-side cursor', () => {
  it('should page the rows through a cursor and leave none behind', async () => {
    const pool = new BunSqlQuerierPool({ url });
    const querier = await pool.getQuerier();
    await createTables(querier);
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

    await dropTables(querier);
    await querier.release();
    await pool.end();
  });
});

async function countCursors(querier: BunSqlQuerier) {
  const rows = await querier.all<{ n: number }>('SELECT count(*)::int AS n FROM pg_cursors');
  return rows[0].n;
}
