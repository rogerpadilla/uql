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
 * (not a `RelationKey`), enabling type-safe usage in `$where`, `$select`, and `$sort`.
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
 * `Omit`, but distributed over `T`'s union members before recombining. Plain `Omit<T, K>` computes
 * `keyof T` up front, which for a union takes the intersection of each member's keys and flattens
 * their property types together - collapsing a discriminated union (e.g. `EntityIndexMeta`'s
 * `type`/`distance` pairing) into a single, non-discriminated shape.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type Unpacked<T> = T extends readonly (infer U)[]
  ? U
  : T extends (...args: unknown[]) => infer U
    ? U
    : T extends Promise<infer U>
      ? U
      : T;
