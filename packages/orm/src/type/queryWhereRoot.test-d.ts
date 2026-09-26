/**
 * The root-level `$where` clauses: `$and`/`$or`/`$not`/`$nor`, `$text`, `$exists`/`$nexists`, a bare
 * `raw()` value, and `refs()` inside one. `queryWhereOperator.test-d.ts` covers per-field operators.
 * Type-checked by `bun run ts` only.
 */
import type { Querier } from '../index.js';
import { raw, refs } from '../util/index.js';

class Person {
  id!: number;
  name!: string;
  age?: number;
  active?: boolean;
}

declare const querier: Querier;

export async function rootClauseArrays() {
  // $and/$or/$not/$nor take an array of clauses, each a QueryWhere or a raw subquery.
  await querier.findMany(Person, { $where: { $and: [{ name: 'x' }, { age: { $gt: 1 } }] } });
  await querier.findMany(Person, { $where: { $or: [{ id: 1 }, { id: 2 }] } });
  await querier.findMany(Person, { $where: { $not: [{ active: true }] } });
  await querier.findMany(Person, { $where: { $nor: [{ active: true }, raw`deleted_at IS NOT NULL`] } });

  // The clauses inside are checked against the same entity.
  // @ts-expect-error 'naem' is not a field of Person
  await querier.findMany(Person, { $where: { $and: [{ naem: 'x' }] } });
  // @ts-expect-error 'naem' is not a field of Person, nested inside $or too
  await querier.findMany(Person, { $where: { $or: [{ id: 1 }, { naem: 'x' }] } });

  // Root clauses combine with plain field conditions in the same $where.
  await querier.findMany(Person, { $where: { active: true, $or: [{ id: 1 }, { id: 2 }] } });
}

export async function fullTextSearch() {
  await querier.findMany(Person, {
    $where: { $text: { $value: 'john', $fields: { name: true }, $config: 'english' } },
  });
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } } });

  // @ts-expect-error 'naem' is not a field of Person
  await querier.findMany(Person, { $where: { $text: { $value: 'john', $fields: { naem: true } } } });
  // @ts-expect-error full-text search reads string columns, so `age` is no field for it
  await querier.findMany(Person, { $where: { $text: { $value: 'john', $fields: { age: true } } } });
  // @ts-expect-error $value is required
  await querier.findMany(Person, { $where: { $text: { $fields: { name: true } } } });

  // Ranked by relevance to that search, most relevant first, then by any other key.
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } }, $sort: { $text: 'desc', name: 'asc' } });
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } }, $sort: { $text: -1 } });
  // Either direction, as any key sorts.
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } }, $sort: { $text: 'asc' } });
  // The relevance itself, under a name of the caller's, most relevant first unless `$order` says otherwise.
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } }, $sort: { $text: { $project: 'score' } } });
  await querier.findMany(Person, {
    $where: { $text: { $value: 'john' } },
    $sort: { $text: { $project: 'score', $order: 'asc' } },
  });
  // @ts-expect-error the relevance is projected under a name
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } }, $sort: { $text: { $project: true } } });
  // @ts-expect-error a direction alone is the plain form
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } }, $sort: { $text: { $order: 'asc' } } });
}

export async function existsSubqueries() {
  await querier.findMany(Person, { $where: { $exists: raw`SELECT 1 FROM sessions WHERE person_id = id` } });
  await querier.findMany(Person, { $where: { $nexists: raw`SELECT 1 FROM bans WHERE person_id = id` } });

  // @ts-expect-error $exists takes a raw subquery, not a plain string
  await querier.findMany(Person, { $where: { $exists: 'SELECT 1' } });
}

export async function rootIsOneMap() {
  await querier.findMany(Person, { $where: { id: 1 } });
  await querier.findMany(Person, { $where: { id: [1, 2] } });
  await querier.findMany(Person, { $where: { $and: [raw`age > 1`] } });

  // @ts-expect-error a bare id is `{ id: 1 }`, or a by-id method
  await querier.findMany(Person, { $where: 1 });
  // @ts-expect-error a list of ids is `{ id: [1, 2] }`
  await querier.findMany(Person, { $where: [1, 2] });
  // @ts-expect-error a bare raw() goes inside `$and`
  await querier.findMany(Person, { $where: raw`age > 1` });
}

/** Each directive sits on the line its error must land on: one reported on `$where` leaves it unused. */
export async function errorsLandOnTheProperty() {
  await querier.findMany(Person, {
    $where: {
      // @ts-expect-error a string against a numeric column
      age: 'one',
    },
  });
  await querier.findMany(Person, {
    $where: {
      // @ts-expect-error a misspelled column
      naem: 'x',
    },
  });
}

export async function rawFieldValue() {
  // A field may compare against a raw SQL expression instead of a literal value.
  await querier.findMany(Person, { $where: { age: raw`EXTRACT(YEAR FROM birth_date)` } });
  await querier.updateOneById(Person, 1, { age: raw`age + 1` });
}

export async function columnRefs() {
  // A field named inside raw SQL, linked to its property the way a statement's keys are.
  const person = refs(Person);
  await querier.findMany(Person, { $where: { $and: [raw`${person.age} > ${person.id}`] } });
  await querier.findMany(Person, { $where: { age: raw`${person.age} + 1` } });
  await querier.updateOneById(Person, 1, { age: raw`${person.age} + 1` });

  class Membership {
    id?: number;
    person?: Person;
    renew(): void {}
  }
  const membership = refs(Membership);
  // @ts-expect-error 'naem' is not a field of Person
  await querier.findMany(Person, { $where: { $and: [raw`${person.naem} IS NULL`] } });
  // @ts-expect-error a relation has no column of its own
  await querier.findMany(Person, { $where: { $and: [raw`${membership.person} IS NULL`] } });
  // @ts-expect-error a method has no column
  await querier.findMany(Person, { $where: { $and: [raw`${membership.renew} IS NULL`] } });
}
