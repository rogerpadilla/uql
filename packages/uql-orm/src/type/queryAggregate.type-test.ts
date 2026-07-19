/**
 * Type-level regression tests for the aggregate API: `$group` (grouped columns) is typed against the
 * entity like `$select`, `$agg` holds computed columns, and `$having`/`$sort` alias keys are
 * constrained to the grouped columns plus computed aliases.
 *
 * Not a runtime test: it has no assertions to execute. It is type-checked by `bun run ts`
 * (tsc over the whole tree), skipped by vitest (which collects only `.test.ts` / `.spec.ts`),
 * and left out of the build (excluded by the `-test.ts` suffix). Each `@ts-expect-error` fails
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
  const count: number = rows[0].count;
  const avgAge: number = rows[0].avgAge;
  void status;
  void count;
  void avgAge;

  // Aggregate-only query (no grouping) is valid.
  await querier.aggregate(User, { $agg: { total: { $count: '*' } } });

  // Negative: a typo'd group-by column is rejected (typed like $select).
  await querier.aggregate(User, {
    // @ts-expect-error 'statuses' is not a field of User
    $group: { statuses: true },
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
}
