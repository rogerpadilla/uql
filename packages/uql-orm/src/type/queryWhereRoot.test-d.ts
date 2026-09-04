/**
 * Type-level regression tests for `QueryWhereRootOperator`: `$and`/`$or`/`$not`/`$nor` (clause
 * arrays), `$text` (full-text search), `$exists`/`$nexists` (raw subqueries), and a bare `raw()` as a
 * field's value. Complements `queryWhereOperator.test-d.ts`, which covers per-field operator
 * gating rather than these root-level clauses.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Querier } from '../index.js';
import { raw } from '../util/index.js';

class Person {
  id!: number;
  name!: string;
  age?: number;
  active?: boolean;
}

declare const querier: Querier;

export async function rootClauseArrays() {
  // $and/$or/$not/$nor take an array of clauses, each a QueryWhereMap or a raw subquery.
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
  await querier.findMany(Person, { $where: { $text: { $value: 'john', $fields: ['name'], $config: 'english' } } });
  await querier.findMany(Person, { $where: { $text: { $value: 'john' } } });

  // @ts-expect-error 'naem' is not a field of Person
  await querier.findMany(Person, { $where: { $text: { $value: 'john', $fields: ['naem'] } } });
  // @ts-expect-error $value is required
  await querier.findMany(Person, { $where: { $text: { $fields: ['name'] } } });
}

export async function existsSubqueries() {
  await querier.findMany(Person, { $where: { $exists: raw`SELECT 1 FROM sessions WHERE person_id = id` } });
  await querier.findMany(Person, { $where: { $nexists: raw`SELECT 1 FROM bans WHERE person_id = id` } });

  // @ts-expect-error $exists takes a raw subquery, not a plain string
  await querier.findMany(Person, { $where: { $exists: 'SELECT 1' } });
}

export async function rawFieldValue() {
  // A field may compare against a raw SQL expression instead of a literal value.
  await querier.findMany(Person, { $where: { age: raw`EXTRACT(YEAR FROM birth_date)` } });
  await querier.updateOneById(Person, 1, { age: raw`age + 1` });
}
