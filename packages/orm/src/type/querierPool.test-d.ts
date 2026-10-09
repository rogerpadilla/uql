/**
 * A querier and a pool both satisfy {@link UniversalQuerier}, so one parameter accepts either, and an
 * operation cannot be added to one and forgotten on the other. Type-checked by `bun run ts` only.
 */
import { raw } from '../util/raw.js';
import type { Querier, QuerierPool, RawRow, SqlQuerier, SqlQuerierPool, UniversalQuerier } from './index.js';

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
    await q.all<{ id: number }>`SELECT 1`;
    await q.run`DELETE FROM article`;
  });

  await pool.transaction(async (q) => {
    // @ts-expect-error a plain QuerierPool's callback gets a Querier, which has no raw SQL executor
    await q.all`SELECT 1`;
  });
}

// ─── SqlQuerierPool: pool-level raw SQL, without acquiring a querier first ───
export async function sqlPoolExposesRawExecutors() {
  await sqlPool.all<{ id: number }>`SELECT * FROM article`;
  await sqlPool.run`DELETE FROM article`;

  // @ts-expect-error a plain QuerierPool has no raw SQL executor at the pool level
  await pool.all`SELECT 1`;
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

/** Raw SQL is a `raw` template binding what it interpolates, on a querier and a pool alike. */
export async function rawSqlTakesOnlyARawTemplate() {
  await sqlQuerier.all`SELECT ${1}`;
  await sqlQuerier.run`SELECT ${'a'}`;
  await sqlPool.all`SELECT ${1}`;
  await sqlPool.run`SELECT ${'a'}`;
  // @ts-expect-error a plain string is not accepted
  await sqlPool.all('SELECT 1');
}

/** `all` and `run` are tags themselves, typed by the row a read names; a `raw` built apart still fits. */
export async function rawSqlAsATag(id: number, maybeTitle: string | undefined) {
  const rows: { id: number }[] = await sqlPool.all<{ id: number }>`SELECT id FROM article WHERE id = ${id}`;
  await sqlQuerier.run`DELETE FROM article WHERE id = ${id}`;
  await sqlPool.all`SELECT ${raw.join([raw`${1}`, raw`${2}`])}`;
  // @ts-expect-error a template literal in parentheses is a string, its values spliced: refused
  await sqlPool.run(`DELETE FROM article WHERE id = ${id}`);
  // @ts-expect-error `undefined` binds nothing: leave it out, or interpolate `null`
  await sqlPool.run`DELETE FROM article WHERE id = ${undefined}`;
  // @ts-expect-error a value that may be `undefined` is refused too, in a fragment as in a statement
  await sqlPool.all`SELECT * FROM article WHERE ${raw`title = ${maybeTitle}`}`;
  // @ts-expect-error a document is bound as JSON text you write, `${JSON.stringify(doc)}`
  await sqlPool.run`UPDATE article SET meta = ${{ a: 1 }}`;
  await sqlPool.all`SELECT * FROM article WHERE id = ANY(${[1, 2]}) AND at > ${new Date()} AND n = ${null}`;
  // @ts-expect-error a row is an object, never a scalar
  await sqlQuerier.all<number>`SELECT 1`;
  const untyped: RawRow[] = await sqlQuerier.all`SELECT 1`;
  return [rows, untyped];
}

/** Trusted SQL text is `raw.text`; `raw` called with a string would splice what it interpolates. */
export async function sqlTextIsNamedApart(id: number) {
  await sqlPool.run(raw.text('DROP TABLE article'));
  // @ts-expect-error `raw` is a tag, so a template literal passed in parentheses is refused
  await sqlPool.run(raw(`DELETE FROM article WHERE id = ${id}`));
}
