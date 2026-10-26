/** An entity's class, an abstract base included. */
export type AbstractType<T> = abstract new (...args: unknown[]) => T;

/** A concrete entity: an abstract base is never a table, so a query or write does not take one. */
export type Type<T> = new (...args: unknown[]) => T;

export type BooleanLike = boolean | 0 | 1;

export type MongoId = {
  toHexString: () => string;
};

/**
 * Every value a column may hold. `Uint8Array` rather than `Buffer`, which would need `@types/node` and
 * collapse to `any` without it, switching every key check off.
 */
export type Scalar = string | number | boolean | bigint | Date | RegExp | Uint8Array | MongoId;

/** A value a JSON document holds whole and every engine compares by equality, as `$addToSet` needs. */
export type JsonScalar = string | number | boolean;

/**
 * Scalar types with a meaningful ordering, accepted by `$lt`/`$lte`/`$gt`/`$gte`/`$between`.
 */
export type QueryComparableScalar = string | number | bigint | Date;

/**
 * Represents a database primary key value.
 */
export type PrimaryKey = string | number | bigint;

/**
 * Brands a JSON field so it reads as a field rather than a relation: `settings?: Json<{ isArchived?: boolean }>`.
 * A bare `Json` holds any JSON value. A `null` in `T` stays `null`, so `Json<X | null>` may be `null`.
 */
export type Json<T extends object | string | number | boolean | null = JsonDocument> = T extends null
  ? null
  : T & JsonBrand;

/** Any value a JSON column holds, which a bare {@link Json} stands for. */
export type JsonDocument = string | number | boolean | readonly unknown[] | { readonly [key: string]: unknown };

declare const json: unique symbol;

/** The marker {@link Json} adds: a symbol key, so no string key, path or autocomplete shows it. */
export interface JsonBrand {
  readonly [json]?: never;
}

/**
 * Whether `T` carries the {@link Json} brand. A primitive matches `Json<infer P>` too, so the key tells.
 */
export type IsJson<T> = typeof json extends keyof T ? true : false;

export type ExpandScalar<T> = T extends Date ? Date | string : T;

/**
 * A raw database result row before entity mapping.
 */
export interface RawRow {
  [key: string]: unknown;
}

/**
 * Whether `A` and `B` are the same type, `readonly` included - which no conditional sees, since
 * assignability ignores the modifier. Two identical generic signatures compare equal only when their
 * deferred bodies do.
 */
export type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** `Omit` whose key must exist and that distributes over unions. See architecture/type-helpers.md. */
export type Except<T, K extends keyof T> = { [P in keyof T as P extends K ? never : P]: T[P] };

/** `T` with each key of `B` replaced by `B`'s: `Except` on the keys both share, then `B` added. */
export type Merge<A, B> = Except<A, keyof A & keyof B> & B;

/** Every key any member of a union has, where `keyof` keeps only the ones they share. */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/**
 * Exactly one key of `T` with its value; every other key is forbidden (`never`). `Pick`, not `Record`,
 * so the chosen key stays linked to `T`'s own property and renames follow it through. Distributes over a
 * union, so each arm keeps its own keys and forbids the others'.
 */
export type ExactlyOne<T> = ExactlyOneOf<T, KeysOfUnion<T>>;

type ExactlyOneOf<T, Keys extends PropertyKey> = T extends unknown
  ? { [K in keyof T]: Readonly<Pick<T, K>> & Partial<Readonly<Record<Exclude<Keys, K>, never>>> }[keyof T]
  : never;

/**
 * At least one key of `T` with its value, the rest optional: the looser sibling of {@link ExactlyOne},
 * for options that combine but cannot all be left out. `Pick`, so every key stays linked to `T`'s own
 * property and renames follow it through. Distributes over a union for the same reason.
 */
export type AtLeastOne<T> = T extends unknown
  ? { [K in keyof T]-?: Required<Pick<T, K>> }[keyof T] & Partial<T>
  : never;

export type Unpacked<T> = T extends readonly (infer U)[]
  ? U
  : T extends (...args: unknown[]) => infer U
    ? U
    : T extends Promise<infer U>
      ? U
      : T;

/** Whether a property holds many values, not one. See architecture/type-helpers.md. */
export type IsMany<V> = [NonNullable<V>] extends [readonly unknown[]] ? true : false;
