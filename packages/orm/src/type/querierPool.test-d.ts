/**
 * A querier and a pool both satisfy {@link UniversalQuerier}, so one parameter accepts either, and an
 * operation cannot be added to one and forgotten on the other. Type-checked by `bun run ts` only.
 */
import type { Querier, QuerierPool, SqlQuerier, SqlQuerierPool, UniversalQuerier } from './index.js';

class Article {
  id!: number;
  title!: string;
}

declare const querier: Querier;
declare const pool: QuerierPool;
declare const sqlQuerier: SqlQuerier;
declare const sqlPool: SqlQuerierPool;

export const assignable: UniversalQuerier[] = [querier, pool, sqlQuerier, sqlPool];

// ─── transaction: the callback receives the pool's own querier type, not the base Querier ───
export async function transactionCallbackIsTypedToThePool() {
  await sqlPool.transaction(async (q) => {
    await q.all<{ id: number }>('SELECT 1');
    await q.run('DELETE FROM article');
  });

  await pool.transaction(async (q) => {
    // @ts-expect-error a plain QuerierPool's callback gets a Querier, which has no raw SQL executor
    await q.all('SELECT 1');
  });
}

// ─── SqlQuerierPool: pool-level raw SQL, without acquiring a querier first ───
export async function sqlPoolExposesRawExecutors() {
  await sqlPool.all<{ id: number }>('SELECT * FROM article');
  await sqlPool.run('DELETE FROM article');

  // @ts-expect-error a plain QuerierPool has no raw SQL executor at the pool level
  await pool.all('SELECT 1');
}

async function write(db: UniversalQuerier) {
  await db.insertOne(Article, { id: 1, title: 'a' });
  await db.updateMany(Article, { $where: { id: 1 } }, { title: 'b' });
  await db.upsertOne(Article, { id: true }, { id: 1, title: 'a' });
  await db.saveMany(Article, [{ id: 1, title: 'a' }]);
  await db.deleteMany(Article, { $where: { id: 1 } });
  await db.restoreMany(Article, { $where: { id: 1 } });
  for await (const _row of db.findManyStream(Article, {})) {
    break;
  }
}

export async function poolAndQuerierAreInterchangeable() {
  await write(querier);
  await write(pool);
}
