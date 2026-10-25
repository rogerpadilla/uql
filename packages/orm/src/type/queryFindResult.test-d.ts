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

class Clip {
  id!: number;
  title!: string;
  embedding?: number[] | null;
}

class Pitch {
  id!: number;
  writer!: Writer;
  clips?: Clip[];
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

  // A falsy `$select` entry leaves its field out rather than selecting.
  const [subtracted] = await querier.findMany(Story, { $select: { points: false } });
  subtracted.title.trim();
  // @ts-expect-error left out by a falsy `$select` entry
  subtracted.points;

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
  const [counted] = await querier.findMany(Story, { $count: { writers: flag } });
  // @ts-expect-error counted only when `flag` is
  const tally: number = counted._count.writers;
  return [title, tally];
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

export async function sortProjections() {
  // A projected distance is on the row beside what `$select` narrowed it to.
  const [near] = await querier.findMany(Clip, {
    $select: { title: true },
    $sort: { embedding: { $vector: [1, 0, 0], $project: 'distance' } },
  });
  near.distance.toFixed();
  near.title.trim();
  // @ts-expect-error left out by the projection, which a projected distance does not widen
  near.embedding;

  // And beside the whole entity where nothing narrows it, from any read.
  const nearest = await querier.findOne(Clip, { $sort: { embedding: { $vector: [1, 0, 0], $project: 'distance' } } });
  nearest?.distance.toFixed();
  nearest?.embedding;

  // A `$text` relevance the same way, and both where a sort projects both.
  const [ranked] = await querier.findMany(Clip, {
    $where: { $text: { $value: 'x' } },
    $sort: { $text: { $project: 'score', $order: 'asc' }, embedding: { $vector: [1, 0, 0], $project: 'distance' } },
  });
  ranked.score.toFixed();
  ranked.distance.toFixed();

  // A populated relation's rows each carry the distance its own sort projects, and the parent does not.
  const [pitch] = await querier.findMany(Pitch, {
    $populate: {
      clips: { $select: { title: true }, $sort: { embedding: { $vector: [1, 0, 0], $project: 'distance' } } },
    },
  });
  pitch.clips.map((it) => it.distance.toFixed() + it.title);
  // @ts-expect-error the distance is the rows', not the parent's
  pitch.distance;

  // A sort that projects nothing adds nothing.
  const [unprojected] = await querier.findMany(Clip, {
    $where: { $text: { $value: 'x' } },
    $sort: { $text: 'desc', embedding: { $vector: [1, 0, 0] } },
  });
  const clip: Clip = unprojected;
  // @ts-expect-error nothing projected a score
  unprojected.score;

  // A query assembled elsewhere names no projection the types can see.
  const q: Query<Clip> = { $sort: { embedding: { $vector: [1, 0, 0], $project: 'distance' } } };
  const [dynamic] = await querier.findMany(Clip, q);
  // @ts-expect-error not captured, so not projected
  dynamic.distance;
  return clip;
}

/** A row is plain data however it is read, so the methods of the class it is read through are not on it. */
class Ledger {
  id!: number;
  total!: number;
  entries?: Pitch[];
  balance(): number {
    return this.total;
  }
}

export async function rowsHaveNoMethods() {
  const [whole] = await querier.findMany(Ledger, {});
  whole.total.toFixed();
  // @ts-expect-error a read row has no methods
  whole.balance();

  const [populated] = await querier.findMany(Ledger, { $populate: { entries: true } });
  populated.entries.map((it) => it.id);
  // @ts-expect-error a read row has no methods
  populated.balance();

  const [excluded] = await querier.findMany(Ledger, { $select: { total: false } });
  // @ts-expect-error a read row has no methods
  excluded.balance();
}
