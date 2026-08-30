/**
 * Type-level regression tests for the shape a find comes back with, once the query's projection
 * shapes it. The other half of that bargain - that capturing the projection did not cost the
 * typo'd-key errors, which TypeScript skips on a naked type parameter - is pinned where those
 * checks already live: `queryInput.test-d.ts` per clause, `queryPopulate.test-d.ts` for a
 * relation's own query.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests).
 */
import type { Querier, Query } from '../index.js';
import { raw } from '../util/index.js';

class Writer {
  id!: number;
  name!: string;
  age?: number;
}

/** Its id is neither branded nor named `id`/`_id`/`uuid`, so `IdKey` cannot name it. */
class Tag {
  pk!: number;
  label!: string;
  weight?: number;
  stories?: Story[];
}

class Story {
  id!: number;
  title!: string;
  points?: number;
  writer?: Writer;
  writers?: Writer[];
}

declare const querier: Querier;

export async function projectedRows() {
  const [selected] = await querier.findMany(Story, { $select: { id: true, title: true } });
  selected.id.toFixed();
  selected.title.trim();
  // @ts-expect-error a field the projection left out
  selected.points;
  // @ts-expect-error a relation the query did not populate
  selected.writer;

  const one = await querier.findOne(Story, { $select: { title: true } });
  one?.title.trim();
  // @ts-expect-error a field the projection left out
  one?.points;

  const byId = await querier.findOneById(Story, 1, { $select: { title: true } });
  // @ts-expect-error a field the projection left out
  byId?.points;

  // A populated relation comes back, and so does the id the rows are assembled by.
  const [populated] = await querier.findMany(Story, {
    $select: { title: true },
    $populate: { writers: { $select: { name: true } } },
  });
  populated.id.toFixed();
  populated.writers?.[0].name.trim();
  // @ts-expect-error a relation the query did not populate
  populated.writer;
  // @ts-expect-error misspelled column off a loaded relation
  populated.writers?.[0].nmae;

  // A falsy `$select` entry subtracts, like `$exclude`, rather than selecting.
  const [subtracted] = await querier.findMany(Story, { $select: { points: false } });
  subtracted.title.trim();
  // @ts-expect-error subtracted by a falsy `$select` entry
  subtracted.points;
  const [excluded] = await querier.findMany(Story, { $exclude: { points: true } });
  excluded.title.trim();
  // @ts-expect-error excluded
  excluded.points;
  // A falsy `$exclude` entry excludes nothing, which is what the runtime does with it.
  const [keptByFalsyExclude] = await querier.findMany(Story, { $exclude: { points: false } });
  keptByFalsyExclude.points;

  // Modifiers survive: an optional field stays optional.
  const [optional] = await querier.findMany(Story, { $select: { points: true } });
  // @ts-expect-error `points` is optional on the entity, so it is optional on the row
  const points: number = optional.points;
  return points;
}

export async function mixedProjection() {
  // A positive entry wins outright at runtime, and which keys were positive cannot be recovered from
  // the capture - inference collects one union from every entry - so the row keeps its declared shape.
  const [row] = await querier.findMany(Story, { $select: { id: 1, points: 0 } });
  const whole: Story = row;
  return whole;
}

export async function unnameableId() {
  // Populating keeps the id, but only where the id can be named: widening to every field would
  // claim the whole entity came back.
  const [tag] = await querier.findMany(Tag, { $select: { label: true }, $populate: { stories: true } });
  tag.label.trim();
  tag.stories?.[0].title.trim();
  // @ts-expect-error a field the projection left out, even though the row carries an unnameable id
  tag.weight;
}

export async function unprojectedRows() {
  // Nothing to narrow by: the entity itself, class identity included.
  const [whole] = await querier.findMany(Story, { $where: { points: 1 }, $populate: { writer: true } });
  const story: Story = whole;
  story.writer;

  // Raw projections name columns rather than fields, so the row keeps the entity's shape.
  const [rawRow] = await querier.findMany(Story, { $select: [raw('*'), raw('LOG10(points)', 'score')] });
  rawRow.points;

  // A query assembled elsewhere carries no static projection, and a wrapper over one still compiles.
  const q: Query<Story> = { $select: { id: true } };
  const [dynamic] = await querier.findMany(Story, q);
  const same: Story = dynamic;
  return same;
}

export function passThrough<E extends object>(entity: new () => E, q: Query<E>) {
  return querier.findMany(entity, q);
}
