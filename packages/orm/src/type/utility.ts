export type Type<T> = (new (...args: unknown[]) => T) | (abstract new (...args: unknown[]) => T);

export type BooleanLike = boolean | 0 | 1;

export type MongoId = {
  toHexString: () => string;
};

/**
 * Every value a column may hold. `Uint8Array` rather than `Buffer`, which would need `@types/node` and
 * collapse to `any` without it, switching every key check off.
 */
export type Scalar = string | number | boolean | bigint | Date | RegExp | Uint8Array | MongoId;

/**
 * Scalar types with a meaningful ordering, accepted by `$lt`/`$lte`/`$gt`/`$gte`/`$between`.
 */
export type QueryComparableScalar = string | number | bigint | Date;

/**
 * Represents a database primary key value.
 */
export type PrimaryKey = string | number | bigint;

/**
 * Brands a JSON field, `settings?: Json<{ isArchived?: boolean }>`, so it reads as a field rather than a
 * relation; `Json<T>[]` is a list of documents.
 */
export type Json<T = unknown> = T & { readonly __json?: never };

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

/**
 * `Omit` whose key has to exist, which distributes over a union rather than flattening it, and removes
 * a key from a type with an index signature.
 */
export type Except<T, K extends keyof T> = { [P in keyof T as P extends K ? never : P]: T[P] };

/**
 * Each key of `K` mapped to `never`, so an intersection with it makes naming one a compile error;
 * `unknown`, inert, when there are none. A captured type parameter needs it: TypeScript skips the
 * excess-property check on one.
 */
export type RejectKeys<K> = [K] extends [never] ? unknown : Record<K & string, never>;

/**
 * Exactly one key of `T` with its value; every other key is forbidden (`never`). `Pick`, not `Record`,
 * so the chosen key stays linked to `T`'s own property and renames follow it through.
 */
export type ExactlyOne<T> = {
  [K in keyof T]: Readonly<Pick<T, K>> & Partial<Readonly<Record<Exclude<keyof T, K>, never>>>;
}[keyof T];

export type Unpacked<T> = T extends readonly (infer U)[]
  ? U
  : T extends (...args: unknown[]) => infer U
    ? U
    : T extends Promise<infer U>
      ? U
      : T;

/**
 * Whether the value a property holds is many rather than one: a to-many relation, a scalar array, a
 * vector. Every array test in the type layer goes through this, because writing one by hand gets some
 * part of it wrong in ways nothing reports. `isMany.test-d.ts` has one case per part, and says what
 * each is load-bearing for.
 */
export type IsMany<V> = [NonNullable<V>] extends [readonly unknown[]] ? true : false;
