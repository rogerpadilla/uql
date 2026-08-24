/**
 * Type-level regression tests for {@link IsMany}: one case per part it is built from, each verified to
 * fail if that part is dropped, plus the answers its callers depend on that reading it does not reveal.
 *
 * Not a runtime test: it is type-checked by `bun run ts`, skipped by vitest, and left out of the build
 * (excluded by the `.test-d.ts` suffix).
 */
import type { IsMany } from './utility.js';

type IsEqual<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _array = Expect<IsEqual<IsMany<string[]>, true>>;
type _entity = Expect<IsEqual<IsMany<{ id: number }>, false>>;

// A property is declared optional, so the test has to see through the `undefined` rather than
// distribute over it into both arms at once.
type _optionalArray = Expect<IsEqual<IsMany<string[] | undefined>, true>>;
type _optionalScalar = Expect<IsEqual<IsMany<string | undefined>, false>>;

// A `readonly` array is still many.
type _readonly = Expect<IsEqual<IsMany<readonly string[] | undefined>, true>>;

// What the brackets are for, and the only input that can tell they are there: `NonNullable<V>` is an
// intersection rather than a naked type parameter, so it blocks distribution on its own and every case
// above passes unbracketed too. `any` is the exception - it matches both arms and answers `boolean`,
// which reaches `QueryPopulateRelationOptions` as both cardinalities at once.
type _any = Expect<IsEqual<IsMany<any>, true>>;

// Array-like is not an array. Both of these are `Scalar`s, and `QueryAllowedOp` reads this answer to
// decide whether a field gets `$in`-style array operators: were either of them to read as many, every
// string column would offer operators the dialects only emit for a real array column.
type _binary = Expect<IsEqual<IsMany<Uint8Array>, false>>;
type _string = Expect<IsEqual<IsMany<string>, false>>;

// `NonNullable<never>` is `never`, and `never` is assignable to anything, so a `never` input answers
// `true` rather than `false`. That is why `JsonUpdateOpFor` tests `[T] extends [never]` before asking
// this: a non-JSON field reaches it as `never`, and it is meant to fall out as "no JSON operators
// apply" rather than as "the payload is an array". The guard is redundant while this stays `true` and
// load-bearing the moment it does not, so it is pinned here rather than left to be discovered.
type _never = Expect<IsEqual<IsMany<never>, true>>;
