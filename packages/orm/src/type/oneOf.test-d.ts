/**
 * Type-level tests for {@link ExactlyOne} and {@link AtLeastOne}, unions included. Type-checked by `bun run ts`.
 */
import type { AtLeastOne, ExactlyOne } from './utility.js';

type Union = { a: number; x?: string } | { b: string };

// Exactly one key, from either arm; the other arm's key is forbidden next to it.
export const exactlyFromA: ExactlyOne<Union> = { a: 1 };
export const exactlyFromB: ExactlyOne<Union> = { b: 'q' };
// @ts-expect-error both arms' keys together is two keys
export const exactlyBoth: ExactlyOne<Union> = { a: 1, b: 'q' };

type Single = { a: number; b: string };
export const singleA: ExactlyOne<Single> = { a: 1 };
// @ts-expect-error a non-union object still forbids the other key
export const singleBoth: ExactlyOne<Single> = { a: 1, b: 'q' };

// At least one key, from either arm; no keys is an error.
export const atLeastFromA: AtLeastOne<Union> = { a: 1 };
export const atLeastFromB: AtLeastOne<Union> = { b: 'q' };
// @ts-expect-error no key at all
export const atLeastNone: AtLeastOne<Union> = {};

// An optional key is not a choice: `{}` names no key.
type Optional = { a?: number; b?: string };
// @ts-expect-error no key at all, though every key is optional
export const atLeastOptionalNone: AtLeastOne<Optional> = {};
export const atLeastOptionalA: AtLeastOne<Optional> = { a: 1 };
// @ts-expect-error a chosen key keeps its type, so `undefined` is not a value for it
export const atLeastOptionalUndefined: AtLeastOne<Optional> = { a: undefined };
