/**
 * {@link IsMany}: one case per part it is built from, each failing if that part is dropped, plus the
 * answers its callers depend on. Type-checked by `bun run ts` only.
 */
import type { Expect } from './typeTest.test-d.js';
import type { IsEqual, IsMany } from './utility.js';

export type _array = Expect<IsEqual<IsMany<string[]>, true>>;
export type _entity = Expect<IsEqual<IsMany<{ id: number }>, false>>;

// A property is declared optional, so the test has to see through the `undefined` rather than
// distribute over it into both arms at once.
export type _optionalArray = Expect<IsEqual<IsMany<string[] | undefined>, true>>;
export type _optionalScalar = Expect<IsEqual<IsMany<string | undefined>, false>>;

// A `readonly` array is still many.
export type _readonly = Expect<IsEqual<IsMany<readonly string[] | undefined>, true>>;

// What the brackets are for, and the only input that can tell they are there: `NonNullable<V>` is an
// intersection rather than a naked type parameter, so it blocks distribution on its own and every case
// above passes unbracketed too. `any` is the exception - it matches both arms and answers `boolean`,
// which reaches `QueryPopulateRelationOptions` as both cardinalities at once.
export type _any = Expect<IsEqual<IsMany<any>, true>>;

// Array-like is not an array. Both of these are `Scalar`s, and `QueryAllowedOp` reads this answer to
// decide whether a field gets `$in`-style array operators: were either of them to read as many, every
// string column would offer operators the dialects only emit for a real array column.
export type _binary = Expect<IsEqual<IsMany<Uint8Array>, false>>;
export type _string = Expect<IsEqual<IsMany<string>, false>>;

// A `never` input answers `true`, since `never` is assignable to anything. `JsonUpdateOpFor` therefore
// tests `[T] extends [never]` first, so a non-JSON field reads as "no JSON operators" rather than as an
// array; pinned so that guard's reason stays visible.
export type _never = Expect<IsEqual<IsMany<never>, true>>;
