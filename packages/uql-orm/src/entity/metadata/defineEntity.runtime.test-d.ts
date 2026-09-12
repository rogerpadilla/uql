/**
 * What a content type defined at runtime costs at compile time - the only thing it costs, since the
 * runtime half all works: `defineEntity.runtime.spec.ts` registers, migrates and queries one. The
 * shape is unknown when the code is compiled, so the querier checks it against whatever row type the
 * caller can supply, and these pin how much survives at each end of that.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, left out of the build.
 *
 * Every `@ts-expect-error` below sits on the property it is about, which is where TypeScript 7 - what
 * this repo compiles with - reports it. An older compiler reports the same error at the call instead,
 * so an editor running its own 5.x/6.x server marks these unused; the checks hold either way.
 */
import { idKey, type Querier, type Scalar, type Type } from '../../type/index.js';
import { defineEntity, defineField } from './definition.js';

declare const querier: Querier;

/**
 * A shape nobody declared: every key is a column, so every value is a scalar. The key is named even
 * so, and as an intersection, which is what gives `IdKey` a key to find; {@link brandedKey} is the
 * case where it is not called `id`.
 */
type ContentRow = { id: string } & { [column: string]: Scalar };
declare const Dynamic: Type<ContentRow>;

export async function unknownShape() {
  // A whole-row read keeps the row type, and every clause naming a column takes any name - which is
  // the point: no column name in a query written against a runtime content type can be checked.
  const [row] = await querier.findMany(Dynamic, { $where: { servings: 4 }, $sort: { title: 'asc' } });
  const title: Scalar = row['title'];
  await querier.findMany(Dynamic, { $populate: { author: true } });

  // A projection survives, carrying the columns it named: the row is picked by the key set the query
  // captured, which an index signature answers like any other key.
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

/**
 * The third door, for a shape that arrives field by field rather than all at once: `defineField`
 * takes the column name as a plain string, where the bulk map is keyed by the entity and checks a
 * column the class does not declare.
 */
export function registration() {
  class Unknown {}
  defineField(Unknown, 'whateverTheAdminNamedIt', { type: String });

  defineEntity(Recipe, {
    // @ts-expect-error a column the generated class does not have
    fields: { id: { type: Number, isId: true }, titel: { type: String } },
  });
}

/**
 * The audit columns a minted class has no base to extend: `extends` names one. Nothing declares that
 * class's columns, so nothing checks the base against them - where the class does declare its own,
 * `entityOptions.test-d.ts` pins that a base disagreeing about one is a compile error.
 */
export function sharedBase() {
  class Audited {
    createdBy?: string;
  }
  defineEntity(Dynamic, { extends: Audited, fields: { id: { type: 'uuid', isId: true } } });
}
