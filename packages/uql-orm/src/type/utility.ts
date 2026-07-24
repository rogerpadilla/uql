export type Type<T> = (new (...args: unknown[]) => T) | (abstract new (...args: unknown[]) => T);

export type BooleanLike = boolean | 0 | 1;

export type MongoId = {
  toHexString: () => string;
};

/**
 * Every value type storable in an entity column. Superset of {@link QueryComparableScalar}
 * and {@link PrimaryKey}.
 */
export type Scalar = string | number | boolean | bigint | Date | RegExp | Buffer | MongoId;

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

export type Unpacked<T> = T extends (infer U)[]
  ? U
  : T extends (...args: unknown[]) => infer U
    ? U
    : T extends Promise<infer U>
      ? U
      : T;
