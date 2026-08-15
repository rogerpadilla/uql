/**
 * Type-level regression tests for {@link Except}.
 *
 * Each case is one thing `Omit` gets wrong. Not a runtime test: it is type-checked by `bun run ts`,
 * skipped by vitest, and left out of the build (excluded by the `.test-d.ts` suffix).
 */
import type { IndexOptions } from './entity.js';
import type { Except } from './utility.js';

type IsEqual<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// The key has to exist: a typo or a renamed property is a compile error, not a silent no-op.
type Src = { readonly a: string; b?: number; c: boolean };
// @ts-expect-error
type _typo = Except<Src, 'typoo'>;

// `readonly` and `?` survive.
type _modifiers = Expect<IsEqual<Except<Src, 'c'>, { readonly a: string; b?: number }>>;

// Unions distribute instead of collapsing to their common keys, so a discriminant keeps narrowing.
type Union = { type: 'a'; a: number; drop: 1 } | { type: 'b'; b: string; drop: 1 };
type _union = Expect<IsEqual<Except<Union, 'drop'>, { type: 'a'; a: number } | { type: 'b'; b: string }>>;
type _omitCollapses = Expect<IsEqual<Omit<Union, 'drop'>, { type: 'a' | 'b' }>>;

// The real case the above protects: omitting `columns` must not flatten the vector index variants.
declare const index: IndexOptions;
const distance: string | undefined = index.type === 'vector' ? index.distance : undefined;

// An index signature does not widen the excluded key back into existence.
type Indexed = { [k: string]: unknown; known: string };
type _indexed = Expect<IsEqual<Except<Indexed, 'known'>, { [k: string]: unknown }>>;
type _omitKeepsIt = Expect<IsEqual<Omit<Indexed, 'known'>, { [x: string]: unknown; [x: number]: unknown }>>;

export { distance };
