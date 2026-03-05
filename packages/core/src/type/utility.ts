export type Type<T> = (new (...args: unknown[]) => T) | (abstract new (...args: unknown[]) => T);

export type BooleanLike = boolean | 0 | 1;

export type MongoId = {
  toHexString: () => string;
};

export type Scalar = string | number | boolean | bigint | Date | RegExp | Buffer | MongoId;

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

export type ExpandScalar<T> = null | (T extends Date ? Date | string : T);

export type Writable<T> = { -readonly [K in keyof T]: T[K] };

export type Unpacked<T> = T extends (infer U)[]
  ? U
  : T extends (...args: unknown[]) => infer U
    ? U
    : T extends Promise<infer U>
      ? U
      : T;
