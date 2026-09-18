/** {@link Unpacked}: the element of a list, what a function returns or a promise resolves to, the value itself otherwise. Type-checked by `bun run ts` only. */
import type { Expect } from './typeTest.test-d.js';
import type { IsEqual, Unpacked } from './utility.js';

type Company = { id: number };

export type _list = Expect<IsEqual<Unpacked<Company[]>, Company>>;
export type _readonlyList = Expect<IsEqual<Unpacked<readonly Company[]>, Company>>;
export type _one = Expect<IsEqual<Unpacked<Company>, Company>>;

// A declared-optional property distributes: the list arm unwraps, `undefined` passes through.
export type _optionalList = Expect<IsEqual<Unpacked<Company[] | undefined>, Company | undefined>>;

// Public API: a promise and a function's return unwrap too.
export type _promise = Expect<IsEqual<Unpacked<Promise<Company>>, Company>>;
export type _function = Expect<IsEqual<Unpacked<() => Company>, Company>>;
