/**
 * Type-level regression test: a querier and a pool both satisfy {@link UniversalQuerier}, so one
 * parameter accepts either. The pool's surface used to be a hand-written subset of the querier's, and
 * an operation added to one and forgotten on the other would otherwise surface only in a consumer.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, left out of the build.
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
