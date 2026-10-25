/**
 * What a content type defined at runtime costs at compile time; `defineEntity.runtime.spec.ts` covers
 * the runtime half. Each `@ts-expect-error` sits on the property TypeScript 7 reports, where an older
 * compiler reports the call instead. Type-checked by `bun run ts` only.
 */
import { expectTypeOf } from 'vitest';
import { type ColumnType, idKey, type Querier, type Scalar, type SchemaFields, type Type } from '../../type/index.js';
import { f } from '../column.js';
import { defineEntity } from './definition.js';

declare const querier: Querier;

declare const contentType: { name: string; fields: { name: string; type: ColumnType }[] };

/**
 * A schema built from data: its columns are a record, so the row is too. A spread into a literal would
 * drop the record's index signature, which is why the columns are built as one.
 */
const fields: SchemaFields = {
  id: f.uuid().id(),
  ...Object.fromEntries(contentType.fields.map((field) => [field.name, f.column(field.type).nullable()])),
};
const Content = defineEntity({ name: contentType.name, fields });

export async function fromData() {
  // Every clause naming a column takes any name - which is the point: no column name in a query written
  // against a runtime content type can be checked.
  const id = await querier.insertOne(Content, { headline: 'Hello' });
  const [row] = await querier.findMany(Content, { $where: { headline: 'Hello' }, $sort: { id: 1 } });
  expectTypeOf(row['headline']).toEqualTypeOf<unknown>();
  await querier.findOneById(Content, 'some-id');
  return id;
}

/** A shape nobody declared, named by a hand-written type: the key is named, which gives `IdKey` a key to find. */
type ContentRow = { id: string } & { [column: string]: Scalar };
declare const Dynamic: Type<ContentRow>;

export async function unknownShape() {
  const [row] = await querier.findMany(Dynamic, { $where: { servings: 4 }, $sort: { title: 'asc' } });
  const title: Scalar = row['title'];
  await querier.findMany(Dynamic, { $populate: { author: true } });

  // A projection survives, carrying the columns it named: the row picks its `$select` keys, which an
  // index signature answers like any other key.
  const [projected] = await querier.findMany(Dynamic, { $select: { title: true } });
  const projectedTitle: Scalar = projected['title'];

  // Operators stay open on a column typed as every scalar at once, since the type says nothing to
  // check: narrowing to what a boolean and a blob share would leave equality alone.
  await querier.findMany(Dynamic, { $where: { servings: { $gte: 2 } }, $sort: { title: 'desc' } });

  const dynamicId: string | undefined = await querier.insertOne(Dynamic, { title: 'Arepas' });

  return { title, projectedTitle, dynamicId };
}

/**
 * A runtime content type whose key is not named by convention: the brand says which column it is, and
 * the id reads back as its own type. Unbranded it still works, widened to the row's value type.
 */
type KeyedRow = { [idKey]?: 'pk'; pk: number } & { [column: string]: Scalar };
declare const Keyed: Type<KeyedRow>;

export async function brandedKey() {
  const generated: number | undefined = await querier.insertOne(Keyed, { title: 'Arepas' });
  return querier.findOneById(Keyed, generated!);
}

/** The same content type after codegen: the class a generator writes from the stored definition. */
class Recipe {
  id?: number;
  title?: string;
  servings?: number;
  author?: Author;
}

class Author {
  id?: number;
  name?: string;
}

export async function generatedShape() {
  // Everything the entity-first API promises is back: the projection shapes the row, the operator
  // set follows the field's own type, the relation populates, and the id is the id's own type.
  const [row] = await querier.findMany(Recipe, {
    $select: { title: true },
    $where: { servings: { $gte: 2 } },
    $populate: { author: { $select: { name: true } } },
  });
  row.title?.trim();
  row.author?.name?.trim();
  // @ts-expect-error a field the projection left out
  row.servings;
  // @ts-expect-error a misspelled column
  await querier.findMany(Recipe, { $select: { titel: true } });

  const id: number | undefined = await querier.insertOne(Recipe, { title: 'Arepas' });
  return id;
}
