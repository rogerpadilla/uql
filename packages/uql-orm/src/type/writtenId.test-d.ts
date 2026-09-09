/**
 * Type-level regression tests for what a write reports. `WrittenId` is exact where `EntityId` is a
 * union: the column's value on a single key, the key map on a composite, and never both. All four
 * write methods answer in that one shape, which is what makes `insertOne` and `saveOne` comparable.
 *
 * Not a runtime test: type-checked by `bun run ts`, skipped by vitest, left out of the build.
 */
import { idKey, type Querier } from '../index.js';

declare const querier: Querier;

class User {
  id?: string;
  name?: string;
}

class Enrolment {
  [idKey]?: 'studentId' | 'courseId';
  studentId?: number;
  courseId?: string;
  grade?: string;
}

export async function aSingleKeyReportsItsValue() {
  const inserted: string | undefined = await querier.insertOne(User, { name: 'a' });
  const saved: string | undefined = await querier.saveOne(User, { name: 'a' });
  const many: (string | undefined)[] = await querier.insertMany(User, [{ name: 'a' }]);
  return [inserted, saved, many];
}

export async function aCompositeReportsItsKeyMap() {
  const id = await querier.insertOne(Enrolment, { studentId: 1, courseId: 'maths' });
  // @ts-expect-error a composite reports the map, never one column's value
  const notAValue: number | undefined = id;
  const asMap: { studentId?: number; courseId?: string } | undefined = id;
  return [notAValue, asMap];
}

export async function aReportedIdAddressesItsRow() {
  const [id] = await querier.saveMany(Enrolment, [{ studentId: 1, courseId: 'maths', grade: 'A' }]);
  // What a write reports is what a by-id method takes, with nothing in between.
  return id && querier.findOneById(Enrolment, id);
}

/**
 * An entity whose key the type level cannot name - `@Id` refuses one, so this is the `defineEntity`
 * path. `IdKey` is every field there, which no more means composite than it means single, so the
 * report stays the `EntityId` union rather than claiming a map the write never returns.
 */
class Loose {
  pk?: string;
  title?: string;
}

export async function anUnnamedKeyReportsEitherSpelling() {
  const id = await querier.insertOne(Loose, { pk: 'a' });
  // @ts-expect-error deliberately not narrowed: pinning that the union survives where the key has no name
  const narrowed: string | undefined = id;
  return narrowed;
}
