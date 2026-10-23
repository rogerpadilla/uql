/**
 * The shape a find comes back with, narrowed by its projection. That capturing it keeps the typo'd-key
 * errors is pinned in `queryInput.test-d.ts` and `queryPopulate.test-d.ts`. Type-checked by `bun run ts`
 * only.
 */
import type { Querier, Query, QueryFindResult, WireQuery } from '../index.js';
import { sql } from '../util/index.js';

class Agent {
  id!: number;
  email!: string;
}

class Writer {
  id!: number;
  name!: string;
  age?: number;
  agent?: Agent;
  stories?: Story[];
}

class Story {
  id!: number;
  title!: string;
  points?: number;
  writer?: Writer;
  writers?: Writer[];
}

class Pitch {
  id!: number;
  writer!: Writer;
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

  // A populated relation comes back beside what the row selected, and nothing else does.
  const [populated] = await querier.findMany(Story, {
    $select: { title: true },
    $populate: { writers: { $select: { name: true } } },
  });
  populated.title.trim();
  // @ts-expect-error the id, which the projection left out
  populated.id;
  // A populated to-many is a list, empty at worst, so it needs no `!` and no guard.
  populated.writers[0].name.trim();
  populated.writers.map((it) => it.name);
  // @ts-expect-error a relation the query did not populate
  populated.writer;
  // @ts-expect-error misspelled column off a loaded relation
  populated.writers[0].nmae;

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
  // A positive entry wins outright at runtime, so a mixed map selects its positive keys alone.
  const [row] = await querier.findMany(Story, { $select: { id: 1, points: 0 } });
  row.id.toFixed();
  // @ts-expect-error a positive entry selects, so the others are left out
  row.title;
}

export async function nestedRows() {
  // A relation's own projection and populate shape its rows, at every depth.
  const [story] = await querier.findMany(Story, {
    $select: { title: true },
    $populate: { writers: { $select: { name: true }, $populate: { stories: { $select: { points: true } } } } },
  });
  story.writers.map((writer) => writer.stories.map((it) => it.points));
  story.writers[0].name.trim();
  // @ts-expect-error left out by the writer's own projection
  story.writers[0].age;
  // @ts-expect-error left out by the nested story's projection
  story.writers[0].stories[0].title;
  // @ts-expect-error the writer's agent was not populated
  story.writers[0].agent;

  // A to-one comes back present where `$required` keeps only the rows that have it, at any depth.
  const [required] = await querier.findMany(Story, {
    $populate: { writer: { $required: true, $populate: { agent: { $required: true } } } },
  });
  required.writer.agent.email.trim();
  const [optional] = await querier.findMany(Story, { $populate: { writer: { $populate: { agent: true } } } });
  // @ts-expect-error without `$required` a join can find no row
  optional.writer.name;
  optional.writer?.agent?.email;
  const [pitch] = await querier.findMany(Pitch, { $populate: { writer: true } });
  // @ts-expect-error a join can find no row, however the entity declares the relation
  pitch.writer.name;

  // The whole entity still comes back where nothing narrows, with each populated list in it.
  const [whole] = await querier.findMany(Story, { $populate: { writers: { $populate: { stories: true } } } });
  const asStory: Story = whole;
  whole.writers[0].stories.map((it) => it.title);
  return asStory;
}

export async function unprojectedRows() {
  // Nothing to narrow by: the entity itself, class identity included.
  const [whole] = await querier.findMany(Story, { $where: { points: 1 }, $populate: { writer: true } });
  const story: Story = whole;
  story.writer;

  // With no projection a populated to-many is still a list, and the row is still the entity.
  const [listed] = await querier.findMany(Story, { $populate: { writers: true } });
  listed.writers.map((it) => it.name);
  const listedStory: Story = listed;
  listedStory.points;

  // A projection that does not narrow keeps the same promise.
  const [mixed] = await querier.findMany(Story, { $select: { id: 1, points: 0 }, $populate: { writers: true } });
  mixed.writers.map((it) => it.name);

  // Raw projections name columns rather than fields, so the row keeps the entity's shape.
  const [rawRow] = await querier.findMany(Story, { $select: [sql`*`, sql`LOG10(points)`.as('score')] });
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

/** A query an RPC router received, typed for the wire, reaches the querier as it is. */
export function wirePassThrough<E extends object>(entity: new () => E, q: WireQuery<E>) {
  return querier.findMany(entity, q);
}

export async function namedRows() {
  // A query declared apart names its row, and a find with it returns that row.
  const card = {
    $select: { title: true },
    $populate: { writers: { $select: { name: true } } },
  } as const satisfies Query<Story>;
  type Card = QueryFindResult<Story, typeof card>;
  const [row] = await querier.findMany(Story, card);
  const named: Card = row;
  named.writers.map((it) => it.name.trim());
  // @ts-expect-error left out by the query's projection
  named.points;

  // A key union names a plain selection.
  const picked: QueryFindResult<Story, 'id' | 'title'> = { id: 1, title: row.title };
  picked.title.trim();
  return picked.id;
}

declare const flag: boolean;

export async function undecidedEntries() {
  // A `boolean` entry may be either, so what it names may be absent.
  const [selected] = await querier.findMany(Story, { $select: { id: true, title: flag } });
  selected.id.toFixed();
  // @ts-expect-error `title` is selected only when `flag` is
  const title: string = selected.title;
  const [excluded] = await querier.findMany(Story, { $exclude: { title: flag } });
  // @ts-expect-error `title` is left out when `flag` is
  const kept: string = excluded.title;
  const [counted] = await querier.findMany(Story, { $count: { writers: flag } });
  // @ts-expect-error counted only when `flag` is
  const tally: number = counted._count.writers;
  return [title, kept, tally];
}

export async function anUnpopulatedRelationKeepsItsDeclaration() {
  const [row] = await querier.findMany(Story, { $populate: { writers: false } });
  // @ts-expect-error `false` populates nothing
  row.writers.map((it) => it.name);
}

export async function anEmptyProjectionReadsEveryField() {
  const [row] = await querier.findMany(Story, { $select: {} });
  return row.title.trim();
}

// @ts-expect-error the key-union form takes the keys alone
export type KeyUnionTakesKeysAlone = QueryFindResult<Story, 'title', false>;
