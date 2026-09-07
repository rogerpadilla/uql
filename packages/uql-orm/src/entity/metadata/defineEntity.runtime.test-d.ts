/**
 * What a content type defined at runtime costs at compile time - the only thing it costs, since the
 * runtime half all works: `defineEntity.runtime.spec.ts` registers, migrates and queries one. The
 * shape is unknown when the code is compiled, so the querier checks it against whatever row type the
 * caller can supply, and these pin how much survives at each end of that.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, left out of the build.
 */
import type { Querier, Scalar, Type } from '../../type/index.js';
import { defineEntity, defineField } from './definition.js';

declare const querier: Querier;

/** A shape nobody declared: every key is a column, so every value is a scalar. */
type ContentRow = { [column: string]: Scalar };
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

  // Operators follow the value type, and this one spans every column type at once: a boolean has no
  // ordering, so no member of the union offers `$gte`. A narrower value union brings them back.
  // @ts-expect-error `$gte` is not in the operator set shared by the whole `Scalar` union
  await querier.findMany(Dynamic, { $where: { servings: { $gte: 2 } } });

  // An insert returns the id *column's* value, which here is the whole union rather than the number
  // the column holds.
  const dynamicId: Scalar | undefined = await querier.insertOne(Dynamic, { title: 'Arepas' });
  // @ts-expect-error nothing says the column that happens to be the id is the numeric one
  const numericId: number | undefined = dynamicId;

  return { title, projectedTitle, numericId };
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
 * The two ends meet at registration, which is why both are reachable from one API: `defineField`
 * takes the column name as a plain string, so a shape known only at runtime is registered field by
 * field, while the bulk `fields` map is keyed by the entity and checks what codegen wrote.
 */
export function registration() {
  class Unknown {}
  defineField(Unknown, 'whateverTheAdminNamedIt', { type: String });

  defineEntity(Recipe, {
    fields: {
      id: { type: Number, isId: true },
      // @ts-expect-error a column the generated class does not have
      titel: { type: String },
    },
  });
}
