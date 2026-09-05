/**
 * Type-level regression tests for `IdKey`/`IdValue` resolution: the precedence an entity's primary
 * key name is inferred at - `idKey` symbol override, then `_id`, then `id`, then `uuid`, falling back
 * to the full `FieldKey` union when none apply. Every `findOneById`/`updateOneById`/`deleteOneById`
 * call is typed against this, so a wrong id type at any precedence level is a compile error.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the
 * build (excluded by the `.test-d.ts` suffix, Vitest's and `tsd`'s own convention for type-only tests). Each `@ts-expect-error` fails the type-check if the
 * error it guards ever stops happening, keeping the negatives locked in.
 */
import { idKey, type Querier } from '../index.js';

declare const querier: Querier;

// `idKey` wins over every other name it could also have matched.
class WithIdKeySymbol {
  [idKey]?: 'pk';
  pk?: string;
  id?: number;
}

// `_id` wins when there is no `idKey` override.
class WithMongoId {
  _id?: string;
  name?: string;
}

// `id` wins when there is neither an `idKey` override nor `_id`.
class WithId {
  id?: number;
  name?: string;
}

// `uuid` wins when none of the above are present.
class WithUuid {
  uuid?: string;
  name?: string;
}

// With no recognized id shape at all, `IdKey` falls back to the full field union, so every field is
// individually accepted (the caller is expected to know which one is actually the key).
class NoConventionalId {
  code?: string;
  amount?: number;
}

export async function idPrecedence() {
  await querier.findOneById(WithIdKeySymbol, 'x');
  // @ts-expect-error the `idKey` override names `pk` (a string), not `id` (a number)
  await querier.findOneById(WithIdKeySymbol, 1);

  await querier.findOneById(WithMongoId, 'abc');
  // @ts-expect-error `_id` is a string; a number does not match it
  await querier.findOneById(WithMongoId, 1);

  await querier.findOneById(WithId, 1);
  // @ts-expect-error `id` is a number; a string does not match it
  await querier.findOneById(WithId, 'nope');

  await querier.findOneById(WithUuid, 'abc-123');
  // @ts-expect-error `uuid` is a string; a number does not match it
  await querier.findOneById(WithUuid, 1);

  // No conventional id shape: any field's value type is accepted as a candidate key.
  await querier.findOneById(NoConventionalId, 'x');
  await querier.findOneById(NoConventionalId, 1);
  // @ts-expect-error neither field is boolean-valued
  await querier.findOneById(NoConventionalId, true);
}

export async function idPrecedenceIgnoresLowerPriorityShapes() {
  // A class with both `_id` and `id` still resolves to `_id` - the higher-precedence name wins outright,
  // it does not merge into a union of the two.
  class WithBoth {
    _id?: string;
    id?: number;
  }
  await querier.findOneById(WithBoth, 'abc');
  // @ts-expect-error `id` exists on the class, but `_id` outranks it for key resolution
  await querier.findOneById(WithBoth, 1);
}

/**
 * The keys stay optional, so `{}` compiles here too: `IdKey` cannot be made precise (see `EntityId`),
 * and requiring them would demand fields that are not keys. `assertIdValue` is what refuses it, on a
 * single key as much as on a composite - an unchecked one reaches `deleteMany` as no filter at all.
 */
export async function compositeKeyIsAddressedByAnObject() {
  class Enrolment {
    studentId?: number;
    courseId?: number;
  }
  // An object carrying the keys, with no cast: it is also the `$where` map it reduces to.
  await querier.findOneById(Enrolment, { studentId: 1, courseId: 2 });
  await querier.deleteOneById(Enrolment, { studentId: 1, courseId: 2 });
  // @ts-expect-error - a key the entity does not declare
  await querier.findOneById(Enrolment, { studentId: 1, moduleId: 2 });
  // @ts-expect-error - the wrong type for a declared key
  await querier.findOneById(Enrolment, { studentId: 'one' });
}
