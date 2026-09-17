/**
 * `$select`: the field map and the raw-projection array (`raw` templates named with `.as()`).
 * `$select`/`$exclude` exclusivity is enforced at run time, so it has no negative here. Type-checked by
 * `bun run ts` only.
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
  tags?: readonly string[];
  embedding?: readonly number[];
  writer?: Writer;
}

declare const querier: Querier;

export async function selectShapes() {
  // Field-map form.
  await querier.findMany(Story, { $select: { id: true, title: true } });
  await querier.findMany(Story, { $exclude: { points: true } });

  // Raw-projection array form.
  await querier.findMany(Story, {
    $select: [raw`*`, raw`LOG10(points + 1) * 287014.58 + id`.as('hotness')],
    $sort: { points: -1 },
  });

  // Both `$select` forms flow into a populated relation's own query.
  await querier.findMany(Story, { $populate: { writer: { $select: { name: true } } } });
  await querier.findMany(Story, { $populate: { writer: { $select: [raw`COUNT(*)`.as('n')] } } });

  // @ts-expect-error $select array entries must be QueryRaw instances
  await querier.findMany(Story, { $select: [1] });
  // @ts-expect-error plain strings are not accepted in the array form
  await querier.findMany(Story, { $select: ['id'] });
  // @ts-expect-error an alias is `.as()`, the one spelling a template takes too
  raw(() => 'points', 'hotness');
  // A `readonly` scalar array is a field, not a relation: `FieldKey` testing for a mutable `Scalar[]`
  // left both of these out of every field-keyed clause and into `RelationKey` instead.
  await querier.findMany(Story, { $select: { tags: true, embedding: true } });
  await querier.findMany(Story, { $sort: { embedding: { $vector: [1, 2], $distance: 'cosine' } } });

  // @ts-expect-error unknown field in the map form
  await querier.findMany(Story, { $select: { nope: true } });
}
