/**
 * Type-level regression tests for `$count`: which relations it accepts, what each may be given, the
 * `_count` a read comes back with, and the `$sort` that ranks parents by one of those tallies. `$count` captures its relation names as a key set the way
 * `$select`/`$populate` do, so both halves need pinning - that the names shape `_count`, and that
 * capturing them did not cost the typo'd-key errors TypeScript skips on a naked type parameter.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests).
 */
import type { Querier } from '../index.js';

class Comment {
  id!: number;
  body!: string;
  approved?: boolean;
  storyId!: number;
}

class Writer {
  id!: number;
  name!: string;
}

class Story {
  id!: number;
  title!: string;
  points?: number;
  writer?: Writer;
  comments?: Comment[];
}

declare const querier: Querier;

export async function countTakesToManyRelationsOnly(querier: Querier) {
  await querier.findMany(Story, { $count: { comments: true } });
  await querier.findMany(Story, { $count: { comments: { $where: { approved: true } } } });

  // @ts-expect-error a to-one relation resolves to at most one row, so there is nothing to count
  await querier.findMany(Story, { $count: { writer: true } });
  // @ts-expect-error `points` is a field, not a relation
  await querier.findMany(Story, { $count: { points: true } });
  // @ts-expect-error misspelled relation name
  await querier.findMany(Story, { $count: { commnets: true } });
}

/** A count narrows *which* rows it tallies, so it takes a filter and nothing else. */
export async function countTakesAFilterAndNothingElse() {
  await querier.findMany(Story, { $count: { comments: { $where: { body: 'x' } } } });

  // @ts-expect-error misspelled column inside the count's own filter
  await querier.findMany(Story, { $count: { comments: { $where: { boyd: 'x' } } } });
  // @ts-expect-error ordering a tally changes nothing about it
  await querier.findMany(Story, { $count: { comments: { $sort: { body: 1 } } } });
  // @ts-expect-error nor does paging one
  await querier.findMany(Story, { $count: { comments: { $limit: 5 } } });
  // @ts-expect-error a count returns a number, so it has nothing to select
  await querier.findMany(Story, { $count: { comments: { $select: { body: true } } } });
}

/** `_count` carries exactly the relations the query named, each a number. */
export async function countShapesTheResult() {
  const [counted] = await querier.findMany(Story, { $select: { title: true }, $count: { comments: true } });

  counted._count.comments.toFixed();
  counted.title.trim();
  // The id survives the projection, the way it does for a populated relation: the tallies group by it.
  counted.id.toFixed();
  // @ts-expect-error a relation the query did not count
  counted._count.writer;
  // @ts-expect-error a field the projection left out
  counted.points;

  const one = await querier.findOne(Story, { $count: { comments: true } });
  one?._count.comments.toFixed();

  const byId = await querier.findOneById(Story, 1, { $count: { comments: true } });
  byId?._count.comments.toFixed();

  const [[fromPage]] = await querier.findManyAndCount(Story, { $count: { comments: true } });
  fromPage._count.comments.toFixed();
}

/**
 * `$distinct` and a raw `$select` each take away what the tallies group by - the row's id - so both
 * are refused. Runtime, not type-level: `$distinct` is a sibling clause and a raw `$select` is a
 * valid value for its own clause, so neither is expressible as a type error without contorting both.
 */
export async function countRefusesWhatTakesTheIdAway() {
  // Asserted here only for what they are: legal to write. That each *rejects* at runtime is pinned
  // on every backend by `shouldRejectCountingWithDistinct` / `shouldRejectCountingWithARawSelect`.
  await querier.findMany(Story, { $distinct: true, $count: { comments: true } });
  await querier.findMany(Story, { $select: [], $count: { comments: true } });
}

/** A read that counts nothing has no `_count`, rather than an empty one. */
export async function noCountLeavesTheRowAlone() {
  const [plain] = await querier.findMany(Story, { $select: { title: true } });
  // @ts-expect-error the query asked for no counts
  plain._count;
}

/** Counting and populating the same relation are independent: the rows *and* the tally. */
export async function countComposesWithPopulate() {
  const [both] = await querier.findMany(Story, {
    $select: { title: true },
    $populate: { comments: { $limit: 5 } },
    $count: { comments: true },
  });

  both.comments[0].body.trim();
  both._count.comments.toFixed();
}

/** A stream never holds its rows at once, so it has nothing to batch a count over. */
export async function streamsCannotCount() {
  // @ts-expect-error `$count` is batched over a result set a stream does not have
  for await (const _row of querier.findManyStream(Story, { $count: { comments: true } })) break;
}

/**
 * A to-many has no single value to order by, so what `$sort` offers on one instead is its size.
 * A to-one keeps the map of its own fields, which is the only thing that ever made sense there.
 */
export async function sortRanksParentsByARelationCount() {
  await querier.findMany(Story, { $sort: { comments: { $count: -1 } } });
  await querier.findMany(Story, { $sort: { comments: { $count: 1 }, title: 1 } });
  await querier.findMany(Story, { $sort: { writer: { name: 1 } } });

  // @ts-expect-error a parent has many comments, so there is no field of theirs to order by
  await querier.findMany(Story, { $sort: { comments: { body: 1 } } });
  // @ts-expect-error nor a direction that could mean anything against the set of them
  await querier.findMany(Story, { $sort: { comments: -1 } });
  // @ts-expect-error a to-one resolves to one row, so its size is not what orders it
  await querier.findMany(Story, { $sort: { writer: { $count: -1 } } });
  // @ts-expect-error misspelled relation
  await querier.findMany(Story, { $sort: { commnets: { $count: -1 } } });
}
