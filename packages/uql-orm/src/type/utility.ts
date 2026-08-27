export type Type<T> = (new (...args: unknown[]) => T) | (abstract new (...args: unknown[]) => T);

export type BooleanLike = boolean | 0 | 1;

export type MongoId = {
  toHexString: () => string;
};

/**
 * Every value type storable in an entity column. Superset of {@link QueryComparableScalar}
 * and {@link PrimaryKey}.
 *
 * `Uint8Array` rather than `Buffer`, which every `Buffer` still satisfies: naming an ambient Node
 * global here made the whole key-checking layer depend on `@types/node` being in scope. Without it
 * `Buffer` resolves to nothing, this union collapses to `any`, and `FieldKey` - the basis of
 * `$select`, `$where`, `$sort`, `@Index` and `defineEntity({ fields })` - silently stops checking
 * anything. A browser or edge project would have got no type safety and no error saying so.
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
 * Marker type for JSON/JSONB fields.
 * Wrapping a field's TypeScript type with `Json<T>` ensures it is classified as a `FieldKey`
 * (not a `RelationKey`), enabling type-safe usage in `$where`, `$select`, and `$sort`. A column
 * holding a list of documents is `Json<T>[]`, also a field, whose dot-paths address the element.
 *
 * @example
 * ```ts
 * @Field({ type: 'jsonb' })
 * settings?: Json<{ isArchived?: boolean }>;
 * ```
 */
export type Json<T = unknown> = T & { readonly __json?: never };

export type ExpandScalar<T> = T extends Date ? Date | string : T;

/**
 * A raw database result row before entity mapping.
 */
export interface RawRow {
  [key: string]: unknown;
}

export type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * `Omit`, fixed on three counts. Its key has to exist, where `Omit<T, K extends keyof any>` lets a
 * typo or a renamed property silently omit nothing. Being a homomorphic mapped type it distributes
 * over unions, where `Omit` intersects each member's keys and flattens a discriminated union (e.g.
 * `EntityIndexMeta`'s `type`/`distance` pairing) into one non-discriminated shape. And it removes
 * the key from types carrying an index signature, where `Exclude<keyof T, K>` widens back to
 * `string | number` and leaves the key in place.
 */
export type Except<T, K extends keyof T> = { [P in keyof T as P extends K ? never : P]: T[P] };

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
