# Type helpers

The utility types in `packages/orm/src/type/utility.ts` that take a choice of design: why `Except` replaces `Omit`, and why `IsMany` is the test for an entity property holding many values.

## `Except` over `Omit`

`Except<T, K extends keyof T>` is the key-checked form of `Omit`.

- **Typos are caught**: `Omit<T, K>` takes any string as `K`, so `Omit<Post, 'titl'>` compiles and drops nothing. `Except` requires `K extends keyof T`, so the misspelling is an error where it is written.
- **Unions distribute**: `Omit` computes `keyof (A | B)`, the common keys, then picks from that flat set, so `Omit<A | B, 'x'>` loses every key unique to one arm. `Except` is a homomorphic mapped type, which TypeScript distributes over unions: `Except<A | B, 'x'>` is `Except<A, 'x'> | Except<B, 'x'>`.
- **Index signatures and modifiers survive**: `Pick` over a computed key set drops them, `Except` keeps them.

`except.test-d.ts` pins each of these.

## `IsMany`

`IsMany<V>` answers whether a property holds many values: a to-many relation, a scalar array, a vector. Every entity property test goes through it, because a hand-written check gets some part of that wrong without any error. A JSON payload's own arrays are read directly by `JsonPathMembers` and `DeepJsonKeys` in `entity.ts`. `isMany.test-d.ts` has one case per part, and each case says what it is load-bearing for.
