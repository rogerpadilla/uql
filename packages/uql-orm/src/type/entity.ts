import type { IndexType } from '../schema/types.js';
import type { QueryRaw, VectorDistance } from './query.js';
import type { Json, Scalar, Type } from './utility.js';

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
 */
export type FieldKey<E> = {
  readonly [K in keyof E]: NonNullable<E[K]> extends Scalar | Scalar[] | Json ? K : never;
}[Key<E>];

/**
 * Infers the relation names of an entity
 */
export type RelationKey<E> = {
  readonly [K in keyof E]: NonNullable<E[K]> extends Scalar | Scalar[] | Json ? never : K;
}[Key<E>];

/**
 * Recursively derives dot-notation key paths from an object type, up to 5 levels deep.
 * Uses `Scalar` exclusion instead of `Record<string, unknown>` guard because TS object
 * types without an index signature (e.g. `{ public?: 0 | 1 }`) don't extend `Record`.
 */
type DeepJsonKeys<T, D extends unknown[] = []> = D['length'] extends 5
  ? never
  : {
      [K in keyof T & string]:
        | K
        | (NonNullable<T[K]> extends Scalar ? never : `${K}.${DeepJsonKeys<NonNullable<T[K]>, [...D, unknown]>}`);
    }[keyof T & string];

/**
 * Derives valid dot-notation paths from `Json<T>` fields (up to 5 levels deep).
 * For `kind?: Json<{ public: number; theme: { color: string } }>`,
 * this produces `'kind.public' | 'kind.theme' | 'kind.theme.color'`.
 */
export type JsonFieldPaths<E> = {
  readonly [K in FieldKey<E>]: NonNullable<E[K]> extends Json
    ? `${K & string}.${Exclude<DeepJsonKeys<NonNullable<E[K]>>, '__json'>}`
    : never;
}[FieldKey<E>];

/**
 * Extracts only the array-typed keys from `T`, mapping each to its element type.
 * Used by `$push` to provide type-safe append targets.
 */
export type JsonPushFields<T> = {
  [K in keyof T as NonNullable<T[K]> extends unknown[] ? K & string : never]?: NonNullable<T[K]> extends (infer U)[]
    ? U
    : never;
};

/**
 * Operator shape accepted by JSON/JSONB fields in update payloads.
 * Provides type-safe `$merge`, `$unset`, and `$push` operations with IDE autocomplete.
 *
 * @example
 * ```ts
 * // merge only — autocompletes keys from the JSON field's inner type
 * querier.updateOneById(Company, id, { kind: { $merge: { public: 1 } } });
 * // unset only — autocompletes keys from the JSON field's inner type
 * querier.updateOneById(Company, id, { kind: { $unset: ['private'] } });
 * // push to array — autocompletes array keys, value matches element type
 * querier.updateOneById(Company, id, { data: { $push: { tags: 'new-tag' } } });
 * // combine all three
 * querier.updateOneById(Company, id, { kind: { $merge: { public: 1 }, $push: { tags: 'x' }, $unset: ['private'] } });
 * ```
 */
export type JsonUpdateOp<T = unknown> = {
  readonly $merge?: Partial<T>;
  readonly $unset?: (keyof T & string)[];
  readonly $push?: JsonPushFields<T>;
};

/**
 * Accepted value for a single field in an update payload.
 * - JSON/JSONB fields additionally accept `JsonUpdateOp<T>` for `$merge`/`$unset`/`$push` operations.
 * - All fields accept `QueryRaw` for raw SQL expressions (e.g. `raw('NOW()')`).
 */
type UpdateFieldValue<V> = NonNullable<V> extends Json<infer T> ? V | JsonUpdateOp<T> | QueryRaw : V | QueryRaw;

/**
 * Payload type for update operations.
 * Widens each field to additionally accept `QueryRaw` or `JsonUpdateOp` (for JSON fields),
 * providing IDE autocomplete for `$merge`/`$push` keys via `Json<infer T>`.
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
 * Infers the value of the key identifier on an entity
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
  readonly onDelete?: OnFieldCallback;

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
   * Foreign key configuration. true for simple FK (default if reference is set), string for named FK, false to disable.
   */
  readonly foreignKey?: boolean | string;
  /**
   * Column comment/description for database documentation.
   */
  readonly comment?: string;
};

export type OnFieldCallback = Scalar | QueryRaw | (() => Scalar | QueryRaw);

export type EntityGetter<E = any> = () => Type<E>;

export type CascadeType = 'persist' | 'delete';

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
 * Vector-specific tuning options shared by `@Index` decorator, entity metadata, and migration schema.
 */
export type VectorIndexOptions = {
  /** Distance metric for vector indexes — maps to operator class. */
  distance?: VectorDistance;
  /** HNSW: max connections per node. */
  m?: number;
  /** HNSW: construction search depth. */
  efConstruction?: number;
  /** IVFFlat: number of inverted lists. */
  lists?: number;
};

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
  /** Index type */
  type?: IndexType;
  /** Partial index condition (WHERE clause) */
  where?: string;
} & VectorIndexOptions;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name?: string;
  id?: IdKey<E>;
  softDelete?: FieldKey<E>;
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
  readonly softDelete?: boolean;
  /** Scalar fields; use `isId: true` on exactly one field for the primary key. */
  readonly fields?: Record<string, FieldOptions>;
  readonly relations?: Record<string, RelationOptions<E>>;
  readonly indexes?: readonly EntityIndexMeta[];
  /** Map hook events to method names on the entity class. */
  readonly hooks?: Partial<Record<HookEvent, readonly string[]>>;
};
