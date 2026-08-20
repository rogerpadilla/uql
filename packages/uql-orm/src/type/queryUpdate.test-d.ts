/**
 * Type-level regression tests for `UpdatePayload` (field typo safety, `raw()` field values, and
 * relations settable via their own entity shape) and `QueryConflictPaths` (`upsertOne`/`upsertMany`'s
 * conflict-path map, typed against the entity like `$select`).
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import type { Querier } from '../index.js';
import { raw } from '../util/index.js';

class Company {
  id!: number;
  name!: string;
}

class Employee {
  id!: number;
  name!: string;
  salary!: number;
  company?: Company;
}

declare const querier: Querier;

export async function updatePayloadSafety() {
  // Plain field values and a raw SQL expression in their place.
  await querier.updateOneById(Employee, 1, { name: 'x', salary: raw('salary + 100') });
  await querier.updateMany(Employee, { $where: { id: 1 } }, { salary: raw('salary * 1.1') });

  // Relations are settable via their own entity shape, not a foreign-key scalar.
  await querier.updateOneById(Employee, 1, { company: { id: 1, name: 'Acme' } });

  // @ts-expect-error 'naem' is not a field of Employee
  await querier.updateOneById(Employee, 1, { naem: 'x' });
  // @ts-expect-error 'naem' is not a field of Employee
  await querier.updateMany(Employee, { $where: { id: 1 } }, { naem: 'x' });
  // @ts-expect-error a relation's value is checked against its own entity's fields
  await querier.updateOneById(Employee, 1, { company: { id: 1, naem: 'Acme' } });
}

export async function conflictPathSafety() {
  await querier.upsertOne(Employee, { id: true }, { id: 1, name: 'x', salary: 1 });
  await querier.upsertMany(Employee, { name: true }, [{ id: 1, name: 'x', salary: 1 }]);

  // @ts-expect-error 'ide' is not a field of Employee
  await querier.upsertOne(Employee, { ide: true }, { id: 1, name: 'x', salary: 1 });
  // @ts-expect-error 'ide' is not a field of Employee
  await querier.upsertMany(Employee, { ide: true }, [{ id: 1, name: 'x', salary: 1 }]);
}

/**
 * An entity carrying a lifecycle hook carries a method, and the whole-record writes used to take
 * `E`, which demanded that method back in the payload: the documented
 * `insertOne(Article, { title: 'Hello' })` did not compile. They take {@link EntityData} now, which
 * is the entity's fields and relations and none of its behaviour.
 */
class Hooked {
  id?: number;
  title?: string;
  slug?: string;
  tags?: Company[];

  // stands in for `@BeforeInsert() generateSlug()`
  generateSlug() {
    this.slug = this.title?.toLowerCase();
  }
}

/** A column the entity declares as required stays required in a write payload. */
class Required {
  id?: number;
  name!: string;
  audit() {}
}

export async function writePayloadsExcludeBehaviour(querier: Querier) {
  await querier.insertOne(Hooked, { title: 'Hello' });
  await querier.insertMany(Hooked, [{ title: 'a' }, { title: 'b' }]);
  await querier.saveOne(Hooked, { title: 'Hello' });
  await querier.upsertOne(Hooked, { title: true }, { title: 'Hello' });
  // relations are persistable data, so they stay in the payload
  await querier.insertOne(Hooked, { title: 'Hello', tags: [{ id: 1, name: 'x' }] });

  await querier.insertOne(Required, { name: 'ok' });
  // @ts-expect-error 'name' is declared required, so the payload has to carry it
  await querier.insertOne(Required, { id: 1 });
  // @ts-expect-error a typo'd column is still caught
  await querier.insertOne(Required, { namo: 'abc' });
  // @ts-expect-error a method is behaviour, not data to persist
  await querier.insertOne(Hooked, { title: 'x', generateSlug: () => {} });
}
