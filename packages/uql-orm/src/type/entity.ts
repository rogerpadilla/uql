import type { ForeignKeyAction, IndexType } from '../schema/types.js';
import type { FilterOptions } from './query.js';
import type { QueryRaw } from './queryRaw.js';
import type { Except, IsMany, Json, Scalar, Type, Unpacked } from './utility.js';
import type { VectorDistance, VectorIndexOptions, VectorIndexType } from './vector.js';

/**
 * Allow to customize the name of the property that identifies an entity
 */
export const idKey = Symbol('idKey');

/**
 * The one filter name uql registers itself, from `@Field({ softDelete })`. Four ends have to agree on
 * it and none would fail if they drifted: the field that registers it, the decorator that reserves
 * the name against a user's own filter, the hard delete that switches it off, and the bypass check
 * that lets it through on an entity which never declared one.
 */
export const SOFT_DELETE_FILTER = 'softDelete';

/**
 * Infers the key names of an entity
 */
export type Key<E> = keyof E & string;

/**
 * Infers the field names of an entity.
 * Includes scalar fields, JSON fields, scalar arrays (e.g. vector `number[]`) and arrays of JSON.
 * The `-?` modifier strips optionality so the indexed access yields clean key unions
 * (without it, optional properties leak `undefined` into the union).
 *
 * `readonly Json[]` is its own arm because the brand sits on the element, so the `Json` arm cannot
 * see it. What keeps a to-many relation out of that arm is the weak-type check: `Json<unknown>` is
 * all-optional, which a class with named properties is not assignable to.
 *
 * The check is bracketed so `any` resolves once rather than matching both this and
 * {@link RelationKey}: an unbracketed `any extends X` satisfies either branch. It reads
 * `readonly Scalar[]`, which every mutable one satisfies too, so declaring a vector or a scalar
 * array `readonly` does not push the field over into {@link RelationKey}.
 */
export type FieldKey<E> = {
  readonly [K in keyof E]-?: [NonNullable<E[K]>] extends [Scalar | readonly Scalar[] | Json | readonly Json[]]
    ? K
    : never;
}[Key<E>];

/**
 * Infers the relation names of an entity: whatever is left once its fields and its methods are
 * taken out. Stated as the complement rather than as {@link FieldKey}'s test negated, so the two
 * cannot drift; methods are subtracted because one is not a `Scalar` and would otherwise read as a
 * relation.
 */
export type RelationKey<E> = Exclude<Key<E>, FieldKey<E> | MethodKey<E>>;

/**
 * Whether `T` carries the `Json` brand. Checks for the `__json` marker key explicitly:
 * a bare `extends Json<infer T>` is not discriminating in check position (primitives match it,
 * inferring junk like `T = string`), while the marker key only exists on branded types.
 */
type IsJson<T> = '__json' extends keyof T ? true : false;

/** The payload `P` of a branded `Json<P>`, or `never` for any non-JSON type. */
type UnwrapJson<T> = IsJson<T> extends true ? (T extends Json<infer P> ? P : never) : never;

/**
 * The one branded value a field value `V` holds: `Json<T>` for both `Json<T>` and `Json<T>[]`, via
 * `Unpacked`, a no-op for the non-array case.
 */
type JsonElement<V> = NonNullable<Unpacked<NonNullable<V>>>;

/** The `Json` payload of a field value `V`; `never` when `V` is not a JSON field. */
type JsonPayload<V> = UnwrapJson<JsonElement<V>>;

/**
 * The fields carrying the `Json` brand, `never` on an entity with none - which is most of them, and
 * what makes {@link JsonFieldPaths} collapse to `never` without deriving a path for anything. Tests
 * the brand rather than the payload, whose extra `Json<infer P>` inference is only worth doing once
 * a field is known to be JSON.
 */
type JsonFieldKey<E> = {
  readonly [K in keyof E]-?: IsJson<JsonElement<E[K]>> extends true ? K : never;
}[Key<E>];

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
 * and arrays of JSON (`Json<{foo: string}>[]`, a column holding a list of documents).
 * For `kind?: Json<{ public: number; theme: { color: string } }>`,
 * produces `'kind.public' | 'kind.theme' | 'kind.theme.color'`.
 * For `items?: Json<{id: string}>[]`, produces `'items.id'`.
 * An untyped `Json<unknown>` field yields the scoped pattern `` `${K}.${string}` ``.
 */
export type JsonFieldPaths<E> = {
  readonly [K in JsonFieldKey<E>]: `${K & string}.${DeepJsonKeys<JsonPayload<E[K]>>}`;
}[JsonFieldKey<E>];

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
 * untyped paths fully permissive in `$where`. Gated on {@link JsonFieldKey}, the same predicate
 * {@link JsonFieldPaths} derives its keys from, so a path that is offered always resolves a value.
 */
export type JsonFieldPathValue<E, P extends string> = P extends `${infer F}.${infer Rest}`
  ? F extends JsonFieldKey<E>
    ? PathValue<JsonPayload<E[F]>, Rest>
    : unknown
  : unknown;

/**
 * Extracts only the array-typed keys from `T`, mapping each to its element type via `Unpacked`.
 * Used by `$push` and `$pull` to provide type-safe element targets.
 */
export type JsonArrayFields<T> = {
  [K in keyof T as IsMany<T[K]> extends true ? K & string : never]?: Unpacked<NonNullable<T[K]>>;
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
  : IsMany<T> extends true
    ? never
    : JsonUpdateOp<T>;

/**
 * Accepted value for a single field in an update payload: the value itself, `null` where the column
 * is nullable, `QueryRaw` for a raw SQL expression (e.g. ``raw`NOW()` ``), and - for JSON object
 * fields - the JSON operators.
 *
 * An optional property is a nullable column, and clearing one is what an update is for, so `null`
 * belongs in the declared type rather than behind a cast.
 */
type UpdateFieldValue<V> = V | (undefined extends V ? null : never) | QueryRaw | JsonUpdateOpFor<V>;

/**
 * An entity's fields and relations, each keeping its declared optionality: what the whole-record
 * writes (`insertOne`, `saveOne`, `upsertOne`, and their `*Many`) persist.
 *
 * Not `E`: that *demands* back every method the class declares, so on an entity carrying a
 * lifecycle hook - `@BeforeInsert() generateSlug()` - a plain `{ title: 'Hello' }` was rejected as
 * "missing the following properties". Method-free entities were unaffected, which is why the other
 * examples worked. No runtime filter can help; the call never gets that far. `Pick` because it
 * stays indexable by `IdKey<E>`, which the write path needs.
 */
export type EntityData<E> = Pick<E, FieldKey<E> | RelationKey<E>>;

/**
 * Payload type for update operations: {@link EntityData} made partial, and widened per field to
 * accept `QueryRaw` or `JsonUpdateOp` (for JSON fields), which gives IDE autocomplete for
 * `$set`/`$push`/`$pull` keys via `Json<infer T>`.
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
 *
 * Nullable, because an entity declares its id optional - nothing has assigned one before the
 * insert. That puts `undefined` inside every by-id method's parameter, where it would mean "no
 * filter"; `assertIdValue` is what rejects it.
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
 * SQL boolean column types
 */
export type BooleanColumnType = 'bool' | 'boolean';

/**
 * SQL vector column types
 */
export type VectorColumnType = 'vector' | 'halfvec' | 'sparsevec';

/**
 * SQL column types supported by uql migrations
 */
export type ColumnType =
  | NumericColumnType
  | StringColumnType
  | DateColumnType
  | JsonColumnType
  | BlobColumnType
  | BooleanColumnType
  | VectorColumnType;

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
 * The {@link FieldType} values legal for a field declared as `V`.
 *
 * This is what makes an explicit `type` an improvement over the reflected one it replaces: the
 * annotation is checked against the property's real TypeScript type, so `@Field({ type: String })` on
 * a `number` no longer compiles into a silent TEXT column. `unknown` shapes fall through to the full
 * {@link FieldType}, keeping genuinely untyped fields usable.
 *
 * JSON is matched on the `__json` brand rather than structurally, because {@link Json} intersects its
 * payload (`Json<string>` really does extend `string`) and would otherwise land on the string arm.
 * Both `Json<T>` and `Json<T>[]` have to be recognised, and the array check has to precede the scalar
 * arms so a `number[]` vector is not read as a `number`.
 */
export type TypeFor<V, T = NonNullable<V>> =
  IsJson<T> extends true
    ? JsonColumnType
    : IsJson<NonNullable<Unpacked<T>>> extends true
      ? JsonColumnType
      : T extends readonly number[]
        ? VectorColumnType
        : T extends string
          ? StringConstructor | StringColumnType
          : T extends number
            ? NumberConstructor | NumericColumnType
            : T extends bigint
              ? BigIntConstructor | NumericColumnType
              : T extends boolean
                ? BooleanConstructor | BooleanColumnType
                : T extends Date
                  ? DateConstructor | DateColumnType
                  : T extends Uint8Array
                    ? BlobColumnType
                    : FieldType;

/**
 * Configurable options for a field, carrying `V`, the value the column holds: what a generator returns
 * and what a default is has to be that value, checked the same way the declared `type` is. `Scalar` by
 *  by default, for the places that handle a field without knowing which one it is.
 */
export type FieldOptions<V = TsTypeOf<FieldType>> = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: FieldType;
  /**
   * Set by `defineField` when the field gave `references` but no `type`, so schema generation resolves
   * the column from the referenced primary key rather than from whatever ended up in `type`. That is
   * what keeps a `uuid` primary key from becoming TEXT on every foreign key pointing at it.
   * Internal bookkeeping - do not set this from a decorator.
   * @internal
   */
  readonly typeFromReference?: boolean;
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
  /**
   * Referential action for the generated foreign key. Delete side only: `onUpdate` below already means
   * a value callback. Reach for `@ManyToOne({ onDelete, onUpdate })` when the update side matters too, or
   * when this disagrees with a relation also declared on the same column (the relation wins).
   * @example `@Field({ references: () => Company, onDelete: 'CASCADE' }) companyId?: string;`
   */
  readonly onDelete?: ForeignKeyAction;
  readonly virtual?: QueryRaw;
  readonly updatable?: boolean;
  readonly eager?: boolean;
  readonly onInsert?: OnFieldCallback<V>;
  readonly onUpdate?: OnFieldCallback<V>;
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
  readonly softDelete?: true | OnFieldCallback<V>;

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
   * The column's DDL default, rendered into `CREATE TABLE` by `formatDefaultValue` - not `V`, unlike
   * the generators above. A JSONB column defaults with the SQL literal it stores, `defaultValue: '{}'`,
   * which is a string whatever the field's TypeScript type is.
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

export type OnFieldCallback<V = TsTypeOf<FieldType>> = V | QueryRaw | (() => V | QueryRaw);

/**
 * The TypeScript types a field may be declared as, given the `type` it registers: the inverse of
 * {@link TypeFor}.
 *
 * Both directions are needed because they are consumed at opposite ends. `defineEntity` keys its bulk
 * `fields` by property name, so the property's type is already known and {@link TypeFor} narrows the
 * `type` allowed. A decorator has it the other way round: `@Field({ type: String })` is checked before
 * the class exists, so the only way to reach the property is to state what `type: String` implies and
 * let the decorator's context position compare it against the real field. Neither can be derived from
 * the other by inference, so `entityOptions.test-d.ts` asserts they agree instead.
 */
export type TsTypeOf<T> = T extends StringConstructor
  ? string
  : T extends NumberConstructor
    ? number
    : T extends BigIntConstructor
      ? bigint
      : T extends BooleanConstructor
        ? boolean
        : T extends DateConstructor
          ? Date
          : T extends StringColumnType
            ? string
            : T extends NumericColumnType
              ? number | bigint
              : T extends BooleanColumnType
                ? boolean
                : T extends DateColumnType
                  ? Date
                  : T extends JsonColumnType
                    ? Json<unknown> | readonly Json<unknown>[]
                    : T extends BlobColumnType
                      ? Uint8Array
                      : T extends VectorColumnType
                        ? readonly number[]
                        : unknown;

/**
 * {@link FieldOptions} for a field declared as `V`, with `type` required and checked by
 * {@link TypeFor}.
 *
 * The second arm is load-bearing rather than a convenience: a foreign-key column may omit `type` so
 * that schema generation resolves it from the referenced primary key instead, picking up that key's
 * `columnType`, length and chained references. Forcing `type: Number` onto
 * `@Field({ references: () => Company })` would silently downgrade a `uuid` key to TEXT on every
 * column pointing at it.
 */
export type FieldOptionsFor<V> =
  | (FieldOptions<NonNullable<V>> & { readonly type: TypeFor<V> })
  | (FieldOptions<NonNullable<V>> & { readonly references: EntityGetter; readonly type?: TypeFor<V> });

/**
 * The entity a relation field points at: `Company` for both `company?: Company` and
 * `companies?: Company[]`.
 */
export type RelationTarget<V> = NonNullable<Unpacked<NonNullable<V>>>;

/**
 * {@link RelationOptions} for a relation field declared as `V`, with `entity` required and pinned to
 * `V`'s own type, and the cardinality restricted to the ones that field shape can hold. Together those
 * reject `@ManyToOne({ entity: () => Other })` on a `Company` field, and any to-many cardinality on a
 * field that is not an array. An array field additionally needs a {@link RelationJoin}.
 */
export type RelationOptionsFor<V> = Omit<RelationOptions<RelationTarget<V>>, 'entity' | 'cardinality'> & {
  readonly entity: EntityGetter<RelationTarget<V>>;
  readonly cardinality: IsMany<V> extends true ? '1m' | 'mm' : '11' | 'm1';
} & (IsMany<V> extends true ? RelationJoin<RelationTarget<V>> : unknown);

/**
 * The method names of an entity, so hook registrations name a method that exists.
 */
export type MethodKey<E> = {
  readonly [K in keyof E]-?: NonNullable<E[K]> extends (...args: never[]) => unknown ? K : never;
}[Key<E>];

/**
 * A deferred reference to an entity class, e.g. `() => Company`.
 *
 * A getter rather than the class itself because decorator expressions are evaluated while the class is
 * being defined, before its binding is initialized, so naming the class directly is a `ReferenceError`
 * for a self-reference and for whichever side of a circular import is evaluated first - the two shapes an
 * entity graph almost always has. Nothing about the standard decorator spec changes that; it only removed
 * the reflected `design:type` that used to make `entity` optional.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- public generic default - changing would break callers
export type EntityGetter<E = any> = () => Type<E>;

export type CascadeType = 'persist' | 'delete';

// oxlint-disable-next-line typescript/no-explicit-any -- public generic default - changing would break callers
export type RelationOptions<E = any> = {
  entity: EntityGetter<E>;
  cardinality: RelationCardinality;
  readonly cascade?: boolean | CascadeType;
  /**
   * Referential actions for the generated foreign key, letting the database cascade instead of the ORM's
   * `cascade` (pick one; declaring both leaves the FK nothing to do). Read from the owning side
   * (`@ManyToOne`, or a `@OneToOne` without `mappedBy`). `onDelete` falls back to the FK field's own
   * `@Field({ onDelete })` when unset here; `onUpdate` has no such fallback since that key already means
   * a value callback on `FieldOptions`.
   */
  readonly onDelete?: ForeignKeyAction;
  readonly onUpdate?: ForeignKeyAction;
  mappedBy?: RelationMappedBy<E>;
  /**
   * The pivot entity of a many-to-many. Unconstrained by `E`: a pivot holds foreign keys to both
   * sides and is not a relation value of the target, so nothing about it is derivable from `E`.
   */
  through?: EntityGetter;
  references?: RelationReferences;
};

/**
 * A relation once `getMeta` has resolved it: `references` is filled in and `mappedBy` is the key its
 * callback named. Consumers read this shape rather than {@link RelationOptions}, so they need no
 * assertions - `fillRelations` establishes the invariant once, and throws where it cannot.
 *
 * `entity` and `through` stay {@link EntityGetter}s. Resolution could call them once and store the class,
 * but only by keeping the authored relations in a second map: it reads them *across* entities, and a
 * circular import can leave the entity being read mid-resolution, where telling "no such relation" apart
 * from "declared, but an inverse side too, so neither owns the foreign key" needs the unresolved shape
 * still there to find. A phase-split metadata map costs more than the call parentheses it saves.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- mirrors RelationOptions' public generic default
export type RelationMeta<E = any> = Omit<RelationOptions<E>, 'mappedBy' | 'references'> & {
  mappedBy?: Key<E>;
  references: RelationReferences;
};

/** How a to-many owner reaches its children: a junction entity, or the join columns by name. */
type RelationOwnerJoin<E> =
  | Required<Pick<RelationOptions<E>, 'through'>>
  | Required<Pick<RelationOptions<E>, 'references'>>;

/**
 * Every way a to-many can say where its rows are. Required because nothing about the field implies it:
 * without one of the three, resolution has no columns to join on and throws.
 */
type RelationJoin<E> = RelationOwnerJoin<E> | Required<Pick<RelationOptions<E>, 'mappedBy'>>;

// `onDelete`/`onUpdate` only here: the owning side is the one that holds the foreign key, so the inverse
// side (`mappedBy`) has no constraint to attach an action to.
type RelationOptionsOwner<E> = Pick<RelationOptions<E>, 'entity' | 'references' | 'cascade' | 'onDelete' | 'onUpdate'>;
type RelationOptionsInverseSide<E> = Pick<RelationOptions<E>, 'entity' | 'cascade'> &
  Required<Pick<RelationOptions<E>, 'mappedBy'>>;
type RelationOptionsThroughOwner<E> = Pick<RelationOptions<E>, 'entity' | 'cascade'> & RelationOwnerJoin<E>;

/**
 * The key names of `E` as values, so `mappedBy` can be written as `(user) => user.company` instead of
 * a string literal and survive a rename.
 *
 * Mapping over `Key<E>` rather than `keyof E` is what makes the callback usable: a homomorphic
 * `[K in keyof E]` inherits the entity's optional modifiers, so `user.company` is
 * `'company' | undefined` and {@link RelationKeyMapper} rejects it - every callback needed a `!`.
 *
 * At runtime a callback only ever reads one property off the map, so a single `Proxy` returning its
 * own key stands in for every entity's: see `RELATION_KEY_MAP`. A key that names neither a field nor
 * a relation of the target is rejected when the entity resolves.
 */
export type RelationKeyMap<E> = { readonly [K in Key<E>]: K };

export type RelationKeyMapper<E> = (keyMap: RelationKeyMap<E>) => Key<E>;

export type RelationReferences = { readonly local: string; readonly foreign: string }[];

export type RelationMappedBy<E> = Key<E> | RelationKeyMapper<E>;

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E> = RelationOptionsOwner<E> | RelationOptionsInverseSide<E>;

export type RelationOneToManyOptions<E> = RelationOptionsInverseSide<E> | RelationOptionsThroughOwner<E>;

export type RelationManyToOneOptions<E> = RelationOptionsOwner<E>;

export type RelationManyToManyOptions<E> = RelationOptionsThroughOwner<E> | RelationOptionsInverseSide<E>;

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
 * One entry of an index: a column name by default, `raw(...)` to index an expression, or an object
 * when the entry needs more than a name.
 *
 * @example
 * ```ts
 * @Index(['tenantId', { column: 'createdAt', order: 'desc' }])   // keyset pagination
 * @Index([raw`lower("email")`], { unique: true })                // case-insensitive uniqueness
 * @Index([{ column: 'body', length: 64 }])                       // MySQL needs a prefix on TEXT
 * @Index(['data'], { type: 'gin' })                              // JSONB containment
 * ```
 *
 * `C` is the entity's `FieldKey` on the `@Index`/`defineEntity` paths, where the decorated class says
 * which columns exist, and `E` the entity itself, which is what checks a JSON entry's path. Both
 * default to the unchecked form for the migration builder's `table.index(...)`, which names raw
 * table columns with no entity in scope.
 */
export type IndexColumnInput<C extends string = string, E = unknown> =
  | C
  | QueryRaw
  | IndexColumnOptions<C>
  | IndexJsonColumnOptions<C, E>;

/**
 * The JSON entries, whose `path` is checked against the payload of the column the same entry names -
 * a mapped union, one arm per JSON field, so `{ column: 'kind', jsonPath: { path: 'thema.color' } }`
 * cannot compile. It matters more here than anywhere else in the index API: a path that is merely
 * *misspelled* still builds a perfectly valid index, one no query will ever match, and nothing at
 * runtime can tell that from the index you meant.
 *
 * `jsonArray`'s path is the array's own, so on a column that *is* the array (`Json<string[]>`) it
 * resolves to `never` and the property can only be omitted, which is exactly the truth.
 *
 * Falls back to the unchecked shape only where there is no entity to check against - the migration
 * builder. An entity with no JSON field at all offers no arm, which is also the truth.
 */
type IndexJsonColumnOptions<C extends string, E> = unknown extends E
  ? IndexColumnModifiers & { readonly column: C | QueryRaw }
  : {
      [K in JsonColumnKey<E>]: IndexColumnPlainModifiers & { readonly column: K } & (
          | { readonly jsonPath: WithCheckedPath<IndexJsonPath, E, K>; readonly jsonArray?: never }
          | { readonly jsonArray: WithCheckedPath<IndexJsonArray, E, K>; readonly jsonPath?: never }
        );
    }[JsonColumnKey<E>];

/**
 * The JSON columns an index can address, which is a wider set than {@link JsonFieldKey}: that one
 * unwraps arrays to find the brand, so a column that *is* an array (`Json<string[]>`) reads as a
 * plain one - right for `$where`, which has no path into it, and wrong for `jsonArray`, whose whole
 * subject is that column.
 */
type JsonColumnKey<E> = {
  readonly [K in keyof E]-?: IsJson<NonNullable<E[K]>> extends true
    ? K
    : IsJson<JsonElement<E[K]>> extends true
      ? K
      : never;
}[Key<E>];

/** The payload a path is checked against: the column's own brand, or that of the documents it holds. */
type JsonColumnPayload<V> = IsJson<NonNullable<V>> extends true ? UnwrapJson<NonNullable<V>> : JsonPayload<V>;

/**
 * A JSON modifier with its `path` narrowed to the ones that column's payload actually has. Everything
 * else - and `path`'s own optionality, which `jsonArray` needs and `jsonPath` does not - is taken
 * from the declared type rather than restated, so a property added to either cannot miss the checked
 * form.
 */
type WithCheckedPath<T extends { path?: string }, E, K extends Key<E>> = Except<T, 'path' & keyof T> & {
  [P in keyof Pick<T, Extract<keyof T, 'path'>>]: DeepJsonKeys<JsonColumnPayload<E[K]>>;
};

/**
 * What an index entry can carry besides the thing being indexed. Shared with the normalized
 * `IndexColumnSchema`, so the authored and internal shapes cannot drift apart.
 */
export type IndexColumnModifiers = {
  /**
   * Index only the first `n` characters. MySQL and MariaDB *require* this to index a `TEXT`/`BLOB`
   * column at all ("used in key specification without a key length"); no other engine accepts it.
   */
  readonly length?: number;
  /** Stored sort order, which lets `ORDER BY ... DESC` pagination use the index. */
  readonly order?: 'asc' | 'desc';
  /** Where NULLs sort. Postgres only. */
  readonly nulls?: 'first' | 'last';
  /** Operator class, e.g. `jsonb_path_ops` for a smaller GIN index. Postgres only. */
  readonly opsClass?: string;
  /** Index a path inside a JSON column. See {@link IndexJsonPath}. */
  readonly jsonPath?: IndexJsonPath;
  /** Index every element of a JSON array. See {@link IndexJsonArray}. */
  readonly jsonArray?: IndexJsonArray;
};

/**
 * An index over one path inside a JSON column, compiled by the same code a `$where` on that path is:
 * an expression index is matched by its own text, so an index spelled even slightly differently is
 * one the planner never reaches for.
 *
 * `type` picks the reading the way an operand's own type does (`jsonCompareMode`): compared as a
 * number, indexed as a number. Which engines have it is `IndexFeature`'s `jsonPath`.
 *
 * @example
 * ```ts
 * @Index([{ column: 'kind', jsonPath: { path: 'theme.color', type: String } }]) // 'kind.theme.color': 'red'
 * @Index([{ column: 'kind', jsonPath: { path: 'rating', type: Number } }])      // 'kind.rating': { $gte: 4 }
 * ```
 */
export type IndexJsonPath = {
  /** The path inside the column, spelled as a `$where` key spells it: `'theme.color'`. */
  readonly path: string;
  /** How the value is read, matching what the queries over it compare against. */
  readonly type: FieldType;
};

/**
 * MySQL's multi-valued index: one key per *element* of the JSON array at `path` (the column itself
 * when there is none), which is the only index `$all`/`$elemMatch` containment can use. `type` is
 * the element's, and a string or binary one needs a `length`, since the cast is what sizes the key.
 *
 * MySQL is alone in having it - `IndexFeature`'s `jsonArray` - and an index asking for it elsewhere
 * is refused rather than silently built.
 *
 * @example
 * ```ts
 * @Index([{ column: 'tags', jsonArray: { type: String, length: 64 } }]) // tags: { $all: [...] }
 * @Index([{ column: 'kind', jsonArray: { path: 'ids', type: Number } }]) // 'kind.ids': { $all: [...] }
 * ```
 */
export type IndexJsonArray = {
  /** The array's path inside the column, spelled as a `$where` key spells it; omit for the column. */
  readonly path?: string;
  /** The element type, matching what the queries over the array compare against. */
  readonly type: FieldType;
  /** Length of a string or binary element, which MySQL's `CHAR(n) ARRAY` cast requires. */
  readonly length?: number;
};

/** The modifiers that do not name a JSON path, and so need no entity to be checked against. */
type IndexColumnPlainModifiers = Except<IndexColumnModifiers, 'jsonPath' | 'jsonArray'>;

export type IndexColumnOptions<C extends string = string> = IndexColumnPlainModifiers & {
  /** The column to index, or `raw(...)` for an expression. */
  readonly column: C | QueryRaw;
};

/**
 * One index entry, normalized: {@link IndexColumnInput}'s three authored shapes all reduce to this
 * before any dialect or generator sees them, so rendering never re-parses the sugar.
 */
export type IndexColumnSchema = IndexColumnModifiers & {
  /** A column name, or raw SQL when {@link expression} is set. */
  readonly column: string;
  /** Whether {@link column} is an expression to emit as-is rather than an identifier to quote. */
  readonly expression?: boolean;
};

/**
 * An index as stored in entity metadata: authored options with the columns normalized.
 */
export type EntityIndexMeta = {
  /** The indexed columns, in order. */
  columns: readonly IndexColumnSchema[];
  /** Custom index name */
  name?: string;
  /** Whether index is unique; omit or `false` for a non-unique index (default). */
  unique?: boolean;
  /** Partial index condition (WHERE clause) */
  where?: string;
  /**
   * Extra columns stored in the index but not part of its key, so a query reading only these is
   * answered from the index alone. Postgres-wire only (`INCLUDE`).
   */
  include?: readonly string[];
} & VectorIndexOptions &
  IndexTypeOptions;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  name?: string;
  /** Set only when the entity named one; unset defers to the pool where it is used. See `AbstractDialect.resolveSchema`. */
  schema?: string;
  id: IdKey<E>;
  softDelete?: FieldKey<E>;
  /** Named, default-on `$where` filters applied to every query unless bypassed. */
  filters?: Record<string, FilterOptions<E>>;
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  } & { [key: string]: FieldOptions | undefined };
  relations: {
    [K in RelationKey<E>]?: RelationMeta;
  } & { [key: string]: RelationMeta | undefined };
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
  /**
   * The schema (in MySQL terms, database) this table lives in, pinning it whichever pool reads it;
   * unset follows the pool's own. Not in `name`: a dotted `name` is rejected.
   */
  readonly schema?: string;
  /** Named, default-on `$where` filters (soft-delete is auto-registered from `@Field({ softDelete })`). */
  readonly filters?: Record<string, FilterOptions<E>>;
  /** Scalar fields; use `isId: true` on exactly one field for the primary key. */
  readonly fields?: { readonly [K in FieldKey<E>]?: FieldOptionsFor<E[K]> };
  readonly relations?: { readonly [K in RelationKey<E>]?: RelationOptionsFor<E[K]> };
  readonly indexes?: readonly EntityIndexInput<FieldKey<E>, E>[];
  /** Map hook events to method names on the entity class. */
  readonly hooks?: Partial<Record<HookEvent, readonly MethodKey<E>[]>>;
};

/**
 * Everything an index carries beyond its columns, shared by `@Index`, `defineEntity` and the
 * migration builder's `table.index(...)`. `Except` (not plain `Omit`) keeps `type`/`distance` a
 * discriminated pair: omitting `distance` on a vector index type is a compile error.
 */
export type IndexOptions<E = unknown> = Except<EntityIndexMeta, 'columns' | 'include' | 'where'> & {
  /** Non-key columns stored in the index; a typo builds nothing, the server refusing the statement. */
  readonly include?: readonly IndexFieldKey<E>[];
  /**
   * Partial-index predicate. `raw` with no interpolation, like an index expression: this is DDL, so
   * there is no placeholder for a bound value. A bare string is the older spelling and still works.
   */
  readonly where?: string | QueryRaw;
};

/** A field of `E`, or any name where there is no entity to check it against - the migration builder. */
type IndexFieldKey<E> = unknown extends E ? string : FieldKey<E>;

/**
 * An index as authored, before `defineIndex` normalizes its columns.
 */
export type EntityIndexInput<C extends string = string, E = unknown> = IndexOptions<E> & {
  readonly columns: readonly IndexColumnInput<C, E>[];
};
