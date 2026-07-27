import type { IndexType } from '../schema/types.js';
import type { FilterMeta, FilterOptions } from './query.js';
import type { QueryRaw } from './queryRaw.js';
import type { Json, Scalar, Type, Unpacked } from './utility.js';
import type { VectorDistance, VectorIndexOptions, VectorIndexType } from './vector.js';

/**
 * Allow to customize the name of the property that identifies an entity
 */
export const idKey = Symbol('idKey');

/**
 * Infers the key names of an entity
 */
export type Key<E> = keyof E & string;

/**
 * Infers the field names of an entity.
 * Includes scalar fields, JSON fields, and scalar arrays (e.g. vector `number[]`).
 * The `-?` modifier strips optionality so the indexed access yields clean key unions
 * (without it, optional properties leak `undefined` into the union).
 */
export type FieldKey<E> = {
  readonly [K in keyof E]-?: NonNullable<E[K]> extends Scalar | Scalar[] | Json ? K : never;
}[Key<E>];

/**
 * Infers the relation names of an entity
 */
export type RelationKey<E> = {
  readonly [K in keyof E]-?: NonNullable<E[K]> extends Scalar | Scalar[] | Json ? never : K;
}[Key<E>];

/**
 * Whether `T` carries the `Json` brand. Checks for the `__json` marker key explicitly:
 * a bare `extends Json<infer T>` is not discriminating in check position (primitives match it,
 * inferring junk like `T = string`), while the marker key only exists on branded types.
 */
type IsJson<T> = '__json' extends keyof T ? true : false;

/** The payload `P` of a branded `Json<P>`, or `never` for any non-JSON type. */
type UnwrapJson<T> = IsJson<T> extends true ? (T extends Json<infer P> ? P : never) : never;

/**
 * The `Json` payload of a field value `V`: both `Json<T>` and `Json<T>[]` yield `T` (via
 * `Unpacked`, a no-op for the non-array case); `never` when `V` is not a JSON field.
 */
type JsonPayload<V> = UnwrapJson<NonNullable<Unpacked<NonNullable<V>>>>;

/**
 * Recursively derives dot-notation key paths from a JSON payload type. Handles every shape at
 * entry: an untyped (`unknown`) payload accepts any suffix via a `string` pattern, scalars are
 * leaves (they contribute no deeper path and self-prune through `` `${K}.${never}` ``), arrays
 * contribute their element type's paths, and objects recurse per key up to 5 levels deep
 * (deeper suffixes stay accepted via the `string` pattern at the cutoff).
 */
type DeepJsonKeys<T, D extends unknown[] = []> = unknown extends T
  ? string
  : NonNullable<T> extends Scalar
    ? never
    : NonNullable<T> extends readonly (infer U)[]
      ? DeepJsonKeys<U, D>
      : D['length'] extends 5
        ? string
        : {
            [K in keyof NonNullable<T> & string]: K | `${K}.${DeepJsonKeys<NonNullable<T>[K], [...D, unknown]>}`;
          }[keyof NonNullable<T> & string];

/**
 * Extracts dot-notation paths from `Json<T>` values, handling both scalar JSON
 * and arrays of JSON (e.g., `Json<{foo: string}>[]` in MongoDB).
 * For `kind?: Json<{ public: number; theme: { color: string } }>`,
 * produces `'kind.public' | 'kind.theme' | 'kind.theme.color'`.
 * For `items?: Json<{id: string}>[]`, produces `'items.id'`.
 * An untyped `Json<unknown>` field yields the scoped pattern `` `${K}.${string}` ``.
 */
export type JsonFieldPaths<E> = {
  readonly [K in FieldKey<E>]: [JsonPayload<E[K]>] extends [never]
    ? never
    : `${K & string}.${Exclude<DeepJsonKeys<JsonPayload<E[K]>>, '__json'>}`;
}[FieldKey<E>];

/**
 * The value type inside `T` at dot-path `P`; `unknown` when unresolvable (e.g. through a
 * `Record<string, unknown>` leaf). Arrays are stepped into via their element type.
 */
type PathValue<T, P extends string> = unknown extends T
  ? unknown
  : NonNullable<T> extends readonly (infer U)[]
    ? PathValue<NonNullable<U>, P>
    : P extends `${infer K}.${infer Rest}`
      ? K extends keyof NonNullable<T>
        ? PathValue<NonNullable<T>[K], Rest>
        : unknown
      : P extends keyof NonNullable<T>
        ? NonNullable<T>[P]
        : unknown;

/**
 * The value type at a JSON dot-path `P` of entity `E`; `unknown` when unresolvable, which keeps
 * untyped paths fully permissive in `$where`.
 */
export type JsonFieldPathValue<E, P extends string> = P extends `${infer F}.${infer Rest}`
  ? F extends FieldKey<E>
    ? [JsonPayload<E[F]>] extends [never]
      ? unknown
      : PathValue<JsonPayload<E[F]>, Rest>
    : unknown
  : unknown;

/**
 * Extracts only the array-typed keys from `T`, mapping each to its element type via `Unpacked`.
 * Used by `$push` and `$pull` to provide type-safe element targets.
 */
export type JsonArrayFields<T> = {
  [K in keyof T as NonNullable<T[K]> extends readonly unknown[] ? K & string : never]?: Unpacked<NonNullable<T[K]>>;
};

/**
 * Operator shape accepted by JSON/JSONB fields in update payloads: `$set`/`$unset` target object
 * keys, `$push`/`$pull` target array elements. All four are type-safe with IDE autocomplete.
 *
 * `$set` is shallow: it assigns the given top-level keys and leaves the rest untouched (it is not
 * an RFC 7396 recursive merge). `$pull` removes *every* element equal to the given value.
 *
 * Operators are applied `$pull` -> `$set` -> `$push` -> `$unset`, so any combination - including
 * `$pull` and `$push` on the same key - yields the same result on every dialect.
 *
 * @example
 * ```ts
 * // set only - autocompletes keys from the JSON field's inner type
 * querier.updateOneById(Company, id, { kind: { $set: { public: 1 } } });
 * // unset only - autocompletes keys from the JSON field's inner type
 * querier.updateOneById(Company, id, { kind: { $unset: ['private'] } });
 * // append to / remove from an array - autocompletes array keys, value matches element type
 * querier.updateOneById(Company, id, { kind: { $push: { tags: 'new-tag' } } });
 * querier.updateOneById(Company, id, { kind: { $pull: { tags: 'stale-tag' } } });
 * // combine
 * querier.updateOneById(Company, id, { kind: { $set: { public: 1 }, $push: { tags: 'x' }, $unset: ['private'] } });
 * ```
 */
export type JsonUpdateOp<T = unknown> = {
  readonly $set?: Partial<T>;
  readonly $unset?: unknown extends T ? string[] : (keyof T & string)[];
  readonly $push?: JsonArrayFields<T>;
  readonly $pull?: JsonArrayFields<T>;
};

/**
 * The {@link JsonUpdateOp} a field accepts, or `never` where the operators do not apply:
 * - Non-JSON fields. {@link UnwrapJson}'s {@link IsJson} guard avoids the non-discriminating bare
 *   `Json<infer T>` match that would otherwise offer `$set`/`$unset` on plain scalar fields.
 * - `Json<T[]>` payloads. All four operators address object keys of the JSON document, so on an
 *   array column none is meaningful: PostgreSQL's `||` would concatenate arrays while
 *   `JSON_SET(arr, '$.k', v)` is a no-op on MySQL and SQLite. Replace the whole value instead.
 *   `Json<unknown>` stays permissive, since `unknown` is not an array.
 */
type JsonUpdateOpFor<V, T = UnwrapJson<NonNullable<V>>> = [T] extends [never]
  ? never
  : T extends readonly unknown[]
    ? never
    : JsonUpdateOp<T>;

/**
 * Accepted value for a single field in an update payload: the value itself, `QueryRaw` for a raw SQL
 * expression (e.g. `raw('NOW()')`), and - for JSON object fields - the JSON operators.
 */
type UpdateFieldValue<V> = V | QueryRaw | JsonUpdateOpFor<V>;

/**
 * Payload type for update operations.
 * Widens each field to additionally accept `QueryRaw` or `JsonUpdateOp` (for JSON fields),
 * providing IDE autocomplete for `$set`/`$push`/`$pull` keys via `Json<infer T>`.
 */
export type UpdatePayload<E> = {
  [K in FieldKey<E>]?: UpdateFieldValue<E[K]>;
} & {
  [K in RelationKey<E>]?: E[K];
};

/**
 * Infers the field values of an entity
 */
export type FieldValue<E> = E[FieldKey<E>];

/**
 * Infers the name of the key identifier on an entity
 */
export type IdKey<E> = E extends { [idKey]?: infer K }
  ? K & FieldKey<E>
  : E extends { _id?: unknown }
    ? '_id' & FieldKey<E>
    : E extends { id?: unknown }
      ? 'id' & FieldKey<E>
      : E extends { uuid?: unknown }
        ? 'uuid' & FieldKey<E>
        : FieldKey<E>;

/**
 * Infers the value of the key identifier on an entity.
 */
export type IdValue<E> = E[IdKey<E>];

/**
 * Infers the values of the relations on an entity
 */
export type RelationValue<E> = E[RelationKey<E>];

/**
 * SQL numeric column types
 */
export type NumericColumnType =
  | 'int'
  | 'integer'
  | 'tinyint'
  | 'smallint'
  | 'bigint'
  | 'float'
  | 'float4'
  | 'float8'
  | 'double'
  | 'double precision'
  | 'decimal'
  | 'numeric'
  | 'real'
  | 'serial'
  | 'smallserial'
  | 'bigserial';

/**
 * SQL string column types
 */
export type StringColumnType = 'char' | 'varchar' | 'text' | 'uuid';

/**
 * SQL date/time column types
 */
export type DateColumnType = 'date' | 'time' | 'datetime' | 'timestamp' | 'timestamptz';

/**
 * SQL JSON column types
 */
export type JsonColumnType = 'json' | 'jsonb';

/**
 * SQL binary/blob column types
 */
export type BlobColumnType = 'blob' | 'bytea';

/**
 * SQL column types supported by uql migrations
 */
export type ColumnType =
  | NumericColumnType
  | StringColumnType
  | DateColumnType
  | JsonColumnType
  | BlobColumnType
  | 'bool'
  | 'boolean'
  | 'vector'
  | 'halfvec'
  | 'sparsevec';

/**
 * Logical types for a field
 */
export type FieldType =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | BigIntConstructor
  | ColumnType;

/**
 * Configurable options for a field
 */
export type FieldOptions = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: FieldType;
  /**
   * Set by `defineField` when `type` was inferred via reflection rather than
   * given explicitly. Internal bookkeeping - do not set this from a decorator.
   * @internal
   */
  readonly typeInferred?: boolean;
  /**
   * Dimensions for vector fields. Used in schema generation.
   * @example `@Field({ type: 'vector', dimensions: 1536 })`
   */
  readonly dimensions?: number;
  /**
   * Default distance metric for vector similarity queries on this field.
   * Queries can override via `$distance`. Defaults to `'cosine'` if omitted.
   * @example `@Field({ type: 'vector', dimensions: 1536, distance: 'cosine' })`
   */
  readonly distance?: VectorDistance;
  /**
   * Entity that this field references (for foreign keys).
   */
  readonly references?: EntityGetter;
  readonly virtual?: QueryRaw;
  readonly updatable?: boolean;
  readonly eager?: boolean;
  readonly onInsert?: OnFieldCallback;
  readonly onUpdate?: OnFieldCallback;
  /**
   * Marks this field as the soft-delete field. Its presence makes the entity "soft deletable":
   * a `delete` becomes an `UPDATE` that stamps this field instead of removing the row, and reads
   * filter it out (`<field> IS NULL`). An entity may have at most one soft-delete field.
   *
   * The value controls what is stamped on delete: `true` stamps the current timestamp
   * (`new Date()`); any other `Scalar`/`QueryRaw` or `() => Scalar | QueryRaw` callback stamps
   * that value (e.g. `() => Date.now()` for an epoch-millis column).
   * @example `@Field({ softDelete: true }) deletedAt?: Date;`
   * @example `@Field({ softDelete: () => Date.now() }) deletedAt?: number;`
   */
  readonly softDelete?: OnFieldCallback;

  // Schema/migration properties
  /**
   * SQL column type for migrations. If not specified, inferred from TypeScript type.
   */
  readonly columnType?: ColumnType;
  /**
   * Field length (e.g. for varchar)
   */
  readonly length?: number;
  /**
   * Field precision (e.g. for decimal)
   */
  readonly precision?: number;
  /**
   * Field scale (e.g. for decimal)
   */
  readonly scale?: number;
  /**
   * Whether the field is nullable
   */
  readonly nullable?: boolean;
  /**
   * Whether the field is unique
   */
  readonly unique?: boolean;
  /**
   * Default value for the column
   */
  readonly defaultValue?: Scalar | Record<string, unknown>;
  /**
   * Whether the column is auto-incrementing (for integer IDs).
   */
  readonly autoIncrement?: boolean;
  /**
   * Index configuration. true for simple index, string for named index.
   */
  readonly index?: boolean | string;
  /**
   * Column comment/description for database documentation.
   */
  readonly comment?: string;
};

export type OnFieldCallback = Scalar | QueryRaw | (() => Scalar | QueryRaw);

// biome-ignore lint/suspicious/noExplicitAny: public generic default - changing would break callers
export type EntityGetter<E = any> = () => Type<E>;

export type CascadeType = 'persist' | 'delete';

// biome-ignore lint/suspicious/noExplicitAny: public generic default - changing would break callers
export type RelationOptions<E = any> = {
  entity?: EntityGetter<E>;
  cardinality: RelationCardinality;
  readonly cascade?: boolean | CascadeType;
  mappedBy?: RelationMappedBy<E>;
  through?: EntityGetter<RelationValue<E>>;
  references?: RelationReferences;
};
type RelationOptionsOwner<E> = Pick<RelationOptions<E>, 'entity' | 'references' | 'cascade'>;
type RelationOptionsInverseSide<E> = Required<Pick<RelationOptions<E>, 'entity' | 'mappedBy'>> &
  Pick<RelationOptions<E>, 'cascade'>;
type RelationOptionsThroughOwner<E> = Required<Pick<RelationOptions<E>, 'entity'>> &
  Pick<RelationOptions<E>, 'through' | 'references' | 'cascade'>;

export type RelationKeyMap<E> = { readonly [K in keyof E]: K } & { readonly [key: string]: string };

export type RelationKeyMapper<E> = (keyMap: RelationKeyMap<E>) => Key<E>;

export type RelationReferences = { readonly local: string; readonly foreign: string }[];

export type RelationMappedBy<E> = Key<E> | RelationKeyMapper<E>;

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationOneToManyOptions<E> = RelationOptionsInverseSide<E> | RelationOptionsThroughOwner<E>;

export type RelationManyToOneOptions<E> = RelationOptionsOwner<E>;

export type RelationManyToManyOptions<E> = RelationOptionsThroughOwner<E> | RelationOptionsInverseSide<E>;

/**
 * Wrapper type for relation type definitions in entities.
 * Used to circumvent ESM modules circular dependency issue caused by reflection metadata saving the type of the property.
 *
 * Usage example:
 * @Entity()
 * export default class User {
 *
 *     @OneToOne(() => Profile, profile => profile.user)
 *     profile: Relation<Profile>;
 *
 * }
 */
export type Relation<T> = T;

/**
 * Lifecycle hook event names.
 */
export type HookEvent =
  | 'beforeInsert'
  | 'afterInsert'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete'
  | 'afterLoad';

/**
 * A registered hook: the method name on the entity class to call.
 */
export type HookRegistration = {
  readonly methodName: string;
};

/**
 * Index type paired with the metric it needs. `distance` is required for {@link VectorIndexType}
 * because omitting it changes the DDL semantics silently: MariaDB's `DISTANCE=` defaults to
 * euclidean (so a cosine query full-scans instead of using the index) and pgvector has no default
 * operator class. MongoDB's `vectorSearch` is excluded - its generator emits no metric at all, so
 * requiring one would demand a value that is dropped.
 *
 * The non-vector arm forbids `distance` (rather than just omitting it) because `VectorIndexOptions`
 * - intersected in below by {@link EntityIndexMeta} - already declares `distance` as optional, for
 * the sake of the migration/introspection schema types that reuse it without this discriminated
 * `type`/`distance` pairing. Without the explicit `never` here, that optional `distance` would
 * survive the intersection and silently typecheck `{ type: 'btree', distance: 'cosine' }`.
 */
export type IndexTypeOptions =
  | { type: VectorIndexType; distance: VectorDistance }
  | { type?: Exclude<IndexType, VectorIndexType>; distance?: never };

/**
 * Index metadata from @Index decorator.
 */
export type EntityIndexMeta = {
  /** Column names in the index */
  columns: string[];
  /** Custom index name */
  name?: string;
  /** Whether index is unique; omit or `false` for a non-unique index (default). */
  unique?: boolean;
  /** Partial index condition (WHERE clause) */
  where?: string;
} & VectorIndexOptions &
  IndexTypeOptions;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name?: string;
  id: IdKey<E>;
  softDelete?: FieldKey<E>;
  /** Named, default-on `$where` filters applied to every query unless bypassed. */
  filters?: Record<string, FilterMeta<E>>;
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  } & { [key: string]: FieldOptions | undefined };
  relations: {
    [K in RelationKey<E>]?: RelationOptions;
  } & { [key: string]: RelationOptions | undefined };
  /** Composite indexes defined via @Index decorator */
  indexes?: EntityIndexMeta[];
  /** Lifecycle hooks registered via @BeforeInsert, @AfterUpdate, etc. */
  hooks?: Partial<Record<HookEvent, HookRegistration[]>>;
  processed?: boolean;
};

/**
 * Configurable options for an entity (`@Entity()` / `defineEntity`).
 *
 * Optional `fields`, `relations`, `indexes`, and `hooks` register metadata in one call for
 * decorator-free setups. Omit them when using `@Field` / `@ManyToOne` / etc.
 */
export type EntityOptions<E = unknown> = {
  readonly name?: string;
  /** Named, default-on `$where` filters (soft-delete is auto-registered from `@Field({ softDelete })`). */
  readonly filters?: Record<string, FilterOptions<E>>;
  /** Scalar fields; use `isId: true` on exactly one field for the primary key. */
  readonly fields?: Record<string, FieldOptions>;
  readonly relations?: Record<string, RelationOptions>;
  readonly indexes?: readonly EntityIndexMeta[];
  /** Map hook events to method names on the entity class. */
  readonly hooks?: Partial<Record<HookEvent, readonly string[]>>;
};
