/**
 * Type-level regression tests for the aggregate API: `$group` (grouped columns) is typed against the
 * entity like `$select`, `$agg` holds computed columns, and `$having`/`$sort` alias keys are
 * constrained to the grouped columns plus computed aliases.
 *
 * Not a runtime test: it has no assertions to execute. It is type-checked by `bun run ts`
 * (tsc over the whole tree), skipped by vitest (which collects only `.test.ts` / `.spec.ts`),
 * and left out of the build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails
 * the type-check if the error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Querier } from '../index.js';

class User {
  id!: number;
  status!: string;
  age!: number;
}

declare const querier: Querier;

export async function aggregateTyping() {
  // Positive: group by a real column, compute aliases, reference them in $having / $sort.
  const rows = await querier.aggregate(User, {
    $group: { status: true },
    $agg: { count: { $count: '*' }, avgAge: { $avg: 'age' } },
    $having: { count: { $gt: 5 } },
    $sort: { avgAge: -1, status: 1 },
  });
  const status: string = rows[0].status;
  // `$count` answers 0 over an empty group; every other op answers NULL, so only this one is
  // non-nullable.
  const count: number = rows[0].count;
  const avgAge: number | null = rows[0].avgAge;
  void status;
  void count;
  void avgAge;
  // @ts-expect-error an average over no rows is NULL, so the result is not a bare number
  const avgAgeNotNullable: number = rows[0].avgAge;
  void avgAgeNotNullable;

  // Aggregate-only query (no grouping) is valid.
  await querier.aggregate(User, { $agg: { total: { $count: '*' } } });

  // Positive: each $having value is typed to that column's result type ($avg -> number,
  // $min over a string column -> string).
  await querier.aggregate(User, {
    $agg: { avgAge: { $avg: 'age' }, firstStatus: { $min: 'status' } },
    $having: { avgAge: { $gt: 30 }, firstStatus: { $startsWith: 'a' } },
  });

  // Negative: a numeric comparison on a string-typed $min result is rejected.
  await querier.aggregate(User, {
    $agg: { firstStatus: { $min: 'status' } },
    // @ts-expect-error firstStatus is a string ($min of a string column), not a number
    $having: { firstStatus: { $gt: 5 } },
  });

  // Negative: a typo'd group-by column is rejected (typed like $select).
  await querier.aggregate(User, {
    // @ts-expect-error 'statuses' is not a field of User
    $group: { statuses: true },
  });

  // Negative: a computed aggregate wrongly placed in $group (it belongs in $agg) is rejected even
  // when a valid group-by column is present alongside it.
  await querier.aggregate(User, {
    // @ts-expect-error 'count' is not a field of User; computed columns go in $agg
    $group: { status: true, count: { $count: '*' } },
  });

  // Negative: a typo'd aggregated field reference is rejected.
  await querier.aggregate(User, {
    // @ts-expect-error 'agee' is not a field of User
    $agg: { avgAge: { $avg: 'agee' } },
  });

  // Negative: a $having alias that is neither a grouped column nor a computed alias is rejected.
  await querier.aggregate(User, {
    $group: { status: true },
    $agg: { count: { $count: '*' } },
    // @ts-expect-error 'conut' is neither a grouped column nor a computed alias
    $having: { conut: { $gt: 5 } },
  });

  // Negative: a $sort alias that is neither a grouped column, computed alias, nor entity field.
  await querier.aggregate(User, {
    $group: { status: true },
    $agg: { count: { $count: '*' } },
    // @ts-expect-error 'conut' is not sortable here
    $sort: { conut: -1 },
  });

  // Positive: flat DISTINCT ops accept a field and resolve to number.
  const distinctRows = await querier.aggregate(User, {
    $group: { status: true },
    $agg: {
      uniqueAges: { $countDistinct: 'age' },
      distinctAgeSum: { $sumDistinct: 'age' },
      distinctAgeAvg: { $avgDistinct: 'age' },
    },
  });
  const uniqueAges: number = distinctRows[0].uniqueAges;
  const distinctAgeSum: number | null = distinctRows[0].distinctAgeSum;
  const distinctAgeAvg: number | null = distinctRows[0].distinctAgeAvg;
  void uniqueAges;
  void distinctAgeSum;
  void distinctAgeAvg;

  // Negative: only $count accepts '*'; every other aggregate requires a real field.
  await querier.aggregate(User, {
    // @ts-expect-error $sum requires a field, not '*'
    $agg: { total: { $sum: '*' } },
  });

  // Negative: $count takes a field or '*', not a numeric literal.
  await querier.aggregate(User, {
    // @ts-expect-error $count no longer accepts 1
    $agg: { total: { $count: 1 } },
  });

  // Negative: a DISTINCT op requires a field ('*' is not allowed).
  await querier.aggregate(User, {
    // @ts-expect-error $countDistinct requires a field, not '*'
    $agg: { uniques: { $countDistinct: '*' } },
  });

  // Negative: $min/$max have no DISTINCT variant.
  await querier.aggregate(User, {
    // @ts-expect-error $minDistinct is not a valid aggregate op
    $agg: { earliest: { $minDistinct: 'age' } },
  });

  // Negative: a typo'd DISTINCT field reference is rejected.
  await querier.aggregate(User, {
    // @ts-expect-error 'agee' is not a field of User
    $agg: { uniques: { $countDistinct: 'agee' } },
  });

  // Negative: exactly one operation per entry - a second op in the same entry is rejected.
  await querier.aggregate(User, {
    // @ts-expect-error 'total' has two aggregate ops; exactly one is allowed
    $agg: { total: { $count: '*', $sum: 'age' } },
  });
}

/**
 * The result row carries exactly the columns the statement emits. It used to carry every field of
 * the entity whenever the compiler could not read `$group` - omitted, hoisted, or annotated - so
 * `rows[0].status` type-checked on a query whose SELECT never mentioned `status`.
 */
export async function resultRowCarriesOnlyEmittedColumns() {
  const aggOnly = await querier.aggregate(User, { $agg: { total: { $sum: 'age' } } });
  const total: number | null = aggOnly[0].total;
  void total;
  // @ts-expect-error `status` was never grouped, so no such column comes back
  void aggOnly[0].status;

  const grouped = await querier.aggregate(User, { $group: { status: true }, $agg: { n: { $count: '*' } } });
  const status: string = grouped[0].status;
  void status;
  // @ts-expect-error `age` was not grouped either
  void grouped[0].age;
}

export async function aggregateArgumentsAreChecked() {
  // @ts-expect-error a SUM over a text column cannot be the `number` the result type promises
  await querier.aggregate(User, { $agg: { s: { $sum: 'status' } } });
  // @ts-expect-error nor can an AVG over one
  await querier.aggregate(User, { $agg: { a: { $avg: 'status' } } });
  // $min/$max keep the column's own type, so any column will do.
  const rows = await querier.aggregate(User, { $agg: { first: { $min: 'status' } } });
  const first: string | null = rows[0].first;
  void first;
}

/**
 * Both would be emitted under the one name (`SELECT "age", COUNT(*) "age" ... GROUP BY "age"`),
 * leaving the driver to keep whichever column it read last.
 */
export async function anAliasMayNotShadowAGroupedColumn() {
  // @ts-expect-error 'age' is already a grouped column
  await querier.aggregate(User, { $group: { age: true }, $agg: { age: { $count: '*' } } });
  // a different alias over the same column is fine
  await querier.aggregate(User, { $group: { age: true }, $agg: { ageCount: { $count: '*' } } });
}
