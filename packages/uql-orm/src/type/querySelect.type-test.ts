/**
 * Type-level regression tests for `$select`: the field-map form and the raw-projection array form
 * (`[raw('*'), raw('LOG10(points)', 'score')]`). `$select`/`$exclude` mutual exclusivity is
 * enforced at runtime (a union-shaped `Query` would degrade error messages), so it has no
 * compile-time negative here.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `-test.ts` suffix).
 */
import type { Querier } from '../index.js';
import { raw } from '../util/index.js';

class Writer {
  id!: number;
  name!: string;
}

class Story {
  id!: number;
  title!: string;
  points?: number;
  writer?: Writer;
}

declare const querier: Querier;

export async function selectShapes() {
  // Field-map form.
  await querier.findMany(Story, { $select: { id: true, title: true } });
  await querier.findMany(Story, { $exclude: { points: true } });

  // Raw-projection array form.
  await querier.findMany(Story, {
    $select: [raw('*'), raw('LOG10(points + 1) * 287014.58 + id', 'hotness')],
    $sort: { points: -1 },
  });

  // Both `$select` forms flow into a populated relation's own query.
  await querier.findMany(Story, { $populate: { writer: { $select: { name: true } } } });
  await querier.findMany(Story, { $populate: { writer: { $select: [raw('COUNT(*)', 'n')] } } });

  // @ts-expect-error $select array entries must be QueryRaw instances
  await querier.findMany(Story, { $select: [1] });
  // @ts-expect-error plain strings are not accepted in the array form
  await querier.findMany(Story, { $select: ['id'] });
  // @ts-expect-error unknown field in the map form
  await querier.findMany(Story, { $select: { nope: true } });
}
