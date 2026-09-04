/**
 * Type-level regression tests for which clauses each statement accepts, and for the values a column
 * accepts. Every negative here compiled once and produced a wrong statement at runtime. The positives
 * matter too: a clause wrongly rejected is as much a regression as one wrongly accepted.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build. Each `@ts-expect-error` fails the type-check if the error it guards ever stops happening.
 */
import type { HttpQuerier } from '../browser/querier/httpQuerier.js';
import type { Querier } from '../index.js';
import type { PgQuerierPool } from '../postgres/index.js';
import type { Query, QueryPage } from './query.js';

class Team {
  id!: number;
  name!: string;
}

class Member {
  id!: number;
  name!: string;
  score?: number;
  teamId?: number;
  team?: Team;
  embedding?: number[];

  displayName(): string {
    return this.name;
  }
}

/**
 * `count` takes the page `updateMany`/`deleteMany` take: a `$skip`/`$limit` settles the matching rows
 * with a SELECT and counts them, rather than choking on an `OFFSET` that a one-row `SELECT COUNT(*)`
 * cannot support directly. It stops short of their `$sort`, which it would only ever discard.
 */
export async function countSettlesAPageLikeAWrite(querier: Querier) {
  await querier.count(Member, { $where: { name: 'x' } });
  await querier.count(Member);
  await querier.count(Member, { $skip: 1 });
  await querier.count(Member, { $limit: 10 });
  await querier.count(Member, { $skip: 1, $limit: 10 });

  // @ts-expect-error ordering picks which rows a page holds, never how many
  await querier.count(Member, { $sort: { score: -1 } });
  // @ts-expect-error `$lock` needs an open transaction that a settled count's SELECT does not hold
  await querier.count(Member, { $lock: true });
}

/**
 * `$candidates` tunes the index behind a vector search, and a vector search only ranks the rows the
 * statement itself returns - so like `$lock` it is statement-level, and a populated relation's own
 * query has nothing to tune.
 */
export async function candidatesIsStatementLevel(querier: Querier) {
  await querier.findMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } }, $limit: 10, $candidates: 200 });

  // @ts-expect-error a relation's rows are assembled after the ranking, so there is no index to tune
  await querier.findMany(Member, { $populate: { team: { $candidates: 200 } } });
}

/** `exists` caps the count itself, so it takes the filter alone: no page of its own to set. */
export async function existsTakesTheFilterAlone(querier: Querier) {
  await querier.exists(Member);
  await querier.exists(Member, { $where: { name: 'x' } });

  // @ts-expect-error the cap is the whole point; a caller's own would only fight it
  await querier.exists(Member, { $limit: 10 });
  // @ts-expect-error nothing to skip past when the answer is a yes or no
  await querier.exists(Member, { $skip: 1 });
  // @ts-expect-error nor is there an order to a yes or no
  await querier.exists(Member, { $sort: { score: -1 } });
}

/**
 * The same acceptance, held where callers actually stand: a `new PgQuerierPool(...)` and a `new
 * HttpQuerier(...)` are concrete classes, and each declared its own `count` for a while, so a clause
 * the interface accepted could still be rejected by the object in hand.
 */
export async function countSettlesAPageOffTheConcreteClassesToo(pool: PgQuerierPool, client: HttpQuerier) {
  await pool.count(Member, { $where: { name: 'x' } });
  await client.count(Member, { $where: { name: 'x' } });
  await pool.count(Member, { $limit: 10 });
  await client.count(Member, { $skip: 1, $limit: 10 });

  // @ts-expect-error the narrowing holds off the concrete classes too, not just the interface
  await pool.count(Member, { $sort: { score: -1 } });
  // @ts-expect-error idem for the HTTP client, which declared its own `count` for a while
  await client.count(Member, { $sort: { score: -1 } });
}

export async function writesTakeTheSameOrderingAsReads(querier: Querier) {
  await querier.findMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } } });
  await querier.findMany(Member, { $sort: { embedding: { $vector: [1, 2, 3], $project: 'score' } } });

  // A write settles its rows with a SELECT before writing, and that SELECT has the projection list
  // to hold the distance, so ranking the rows a write picks is as valid as ranking a read's.
  await querier.updateMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } }, $limit: 10 }, { name: 'x' });
  await querier.deleteMany(Member, { $sort: { embedding: { $vector: [1, 2, 3] } }, $limit: 10 });

  // a plain ordering and page on a write stays legal: both settle their rows before writing.
  await querier.updateMany(Member, { $sort: { score: -1 }, $limit: 1 }, { name: 'x' });
  await querier.deleteMany(Member, { $sort: { score: -1 }, $limit: 1 });
}

export async function methodsAreNotRelations(querier: Querier) {
  await querier.findMany(Member, { $populate: { team: true } });

  // @ts-expect-error `displayName` is a method, not a relation to populate
  await querier.findMany(Member, { $populate: { displayName: true } });
  // @ts-expect-error nor is it a field to select
  await querier.findMany(Member, { $select: { displayName: true } });
}

/**
 * An optional property is a nullable column, so `null` is a value it holds - and clearing one is
 * what an update is for. Both of these needed an `as any` before.
 */
export async function nullIsAValueOfANullableColumn(querier: Querier) {
  await querier.updateMany(Member, { $where: { id: 1 } }, { teamId: null });
  await querier.count(Member, { $where: { teamId: null } });
  await querier.findMany(Member, { $where: { teamId: { $eq: null } } });

  // @ts-expect-error `name` is declared non-optional, so it is a NOT NULL column
  await querier.updateMany(Member, { $where: { id: 1 } }, { name: null });
}

/**
 * `Query` declares `$where`, `$skip` and `$limit` itself rather than intersecting {@link QueryPage},
 * because an assignability check against an intersection is repeated per
 * constituent and every query in a codebase pays it. This pins the inlined copies against
 * {@link QueryPage}, the same shape `count` takes and `updateMany`/`deleteMany` build on.
 * `false`, not `never`, is the failure value: `never` satisfies any constraint, so the assertion
 * would pass on a broken shape.
 */
type AssertTrue<T extends true> = T;
type Mutual<A, B> = A extends B ? (B extends A ? true : false) : false;

export type QueryKeepsFilterAndPagerInSync = AssertTrue<
  Mutual<Pick<Query<Member>, '$where' | '$skip' | '$limit'>, QueryPage<Member>>
>;
