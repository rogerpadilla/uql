/**
 * `UpdatePayload` (typo'd fields, `raw()` values, `$inc`/`$mul`, relations as their own entity shape) and
 * `QueryConflictPaths`, typed against the entity as `$select` is. Type-checked by `bun run ts` only.
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
  await querier.updateOneById(Employee, 1, { name: 'x', salary: raw`salary + 100` });
  await querier.updateMany(Employee, { $where: { id: 1 } }, { salary: raw`salary * 1.1` });

  // Relations are settable via their own entity shape, not a foreign-key scalar.
  await querier.updateOneById(Employee, 1, { company: { id: 1, name: 'Acme' } });

  // @ts-expect-error 'naem' is not a field of Employee
  await querier.updateOneById(Employee, 1, { naem: 'x' });
  // @ts-expect-error 'naem' is not a field of Employee
  await querier.updateMany(Employee, { $where: { id: 1 } }, { naem: 'x' });
  // @ts-expect-error a relation's value is checked against its own entity's fields
  await querier.updateOneById(Employee, 1, { company: { id: 1, naem: 'Acme' } });
}

class Counter {
  id!: number;
  label!: string;
  hits?: number | null;
  total!: bigint;
  owner?: Company;
}

export async function arithmeticSafety() {
  await querier.updateOneById(Counter, 1, { hits: { $inc: 1 }, total: { $inc: 5n } });
  await querier.updateMany(Counter, { $where: { hits: { $gte: 2 } } }, { hits: { $inc: -2 } });
  await querier.updateOneById(Counter, 1, { hits: { $mul: 1.5 }, total: { $mul: 2n } });

  // @ts-expect-error one operator per field, since `$inc` then `$mul` is not `$mul` then `$inc`
  await querier.updateOneById(Counter, 1, { hits: { $inc: 1, $mul: 2 } });
  // @ts-expect-error only a numeric field multiplies
  await querier.updateOneById(Counter, 1, { label: { $mul: 2 } });

  // @ts-expect-error only a numeric field increments
  await querier.updateOneById(Counter, 1, { label: { $inc: 1 } });
  // @ts-expect-error a relation is no number
  await querier.updateOneById(Counter, 1, { owner: { $inc: 1 } });
  // @ts-expect-error the step is a number, as the field is
  await querier.updateOneById(Counter, 1, { hits: { $inc: '1' } });
  // @ts-expect-error a bigint field steps by a bigint, which keeps it exact
  await querier.updateOneById(Counter, 1, { total: { $inc: 1 } });
  // @ts-expect-error an upsert writes whole rows, with no update operator
  await querier.upsertOne(Counter, { id: true }, { id: 1, label: 'x', total: 1n, hits: { $inc: 1 } });
}

export async function conflictPathSafety() {
  await querier.upsertOne(Employee, { id: true }, { id: 1, name: 'x', salary: 1 });
  await querier.upsertMany(Employee, { name: true }, [{ id: 1, name: 'x', salary: 1 }]);

  // @ts-expect-error 'ide' is not a field of Employee
  await querier.upsertOne(Employee, { ide: true }, { id: 1, name: 'x', salary: 1 });
  // @ts-expect-error 'ide' is not a field of Employee
  await querier.upsertMany(Employee, { ide: true }, [{ id: 1, name: 'x', salary: 1 }]);
}

/** A write takes an entity's fields and relations, never its methods: a lifecycle hook is behaviour. */
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

/** A related entity with a hook of its own, whose method a nested row does not carry either. */
class HookedTag {
  id?: number;
  name?: string;
  audit() {}
}

class Tagged {
  id?: number;
  tags?: HookedTag[];
  owner?: HookedTag;
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
  await querier.insertOne(Tagged, { tags: [{ name: 'x' }], owner: { name: 'y' } });
  await querier.updateOneById(Tagged, 1, { tags: [{ name: 'x' }], owner: { name: 'y' } });
  // @ts-expect-error a related row's typo is still caught
  await querier.insertOne(Tagged, { tags: [{ nam: 'x' }] });

  await querier.insertOne(Required, { name: 'ok' });
  // @ts-expect-error 'name' is declared required, so the payload has to carry it
  await querier.insertOne(Required, { id: 1 });
  // @ts-expect-error a typo'd column is still caught
  await querier.insertOne(Required, { namo: 'abc' });
  // @ts-expect-error a method is behaviour, not data to persist
  await querier.insertOne(Hooked, { title: 'x', generateSlug: () => {} });
}
