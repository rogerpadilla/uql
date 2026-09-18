import type { EnumValues, ForeignKeyAction, IndexType } from '../schema/types.js';
import type { FilterOptions, RelationQuery } from './query.js';
import type { ColumnRef, QueryRaw, RelationAggregate } from './queryRaw.js';
import type { QueryWhere } from './queryWhere.js';
import type { Except, ExactlyOne, IsEqual, IsMany, Json, Scalar, Type, Unpacked, Writable } from './utility.js';
import type { VectorDistance, VectorIndexOptions, VectorIndexType } from './vector.js';

/** Brands the property an entity is identified by, where it is not `id`, `_id` or `uuid`. */
export const idKey = Symbol('idKey');

/** The filter `@Field({ softDelete })` registers, a name reserved against an entity's own filters. */
export const SOFT_DELETE_FILTER = 'softDelete';

/** A filter name an entity may declare: any but {@link SOFT_DELETE_FILTER}, which a refusal names. */
export type FilterName<N extends string> = N extends typeof SOFT_DELETE_FILTER
  ? `'${N}' is reserved for the filter @Field({ softDelete }) registers`
  : N;

/** The key names of an entity. */
export type Key<E> = keyof E & string;

/**
 * The field names of an entity: scalars, scalar arrays (a vector) and JSON, including a list of JSON
 * documents, whose brand sits on the element. The check is bracketed so `any` lands on one side, and a
 * class is kept off the `Json` arm by the weak-type check.
 */
export type FieldKey<E> = {
  readonly [K in keyof E]-?: [NonNullable<E[K]>] extends [Scalar | readonly Scalar[] | Json | readonly Json[]]
    ? K
    : never;
}[Key<E>];

/**
 * The fields a caller writes: every one the class does not declare `readonly`. A field the database
 * writes - a relation aggregate, a stored generated column, a trigger-kept stamp - is `readonly`, and
 * its value never reaches the database, so a write payload leaves it out rather than dropping it.
 */
export type WritableKey<E> = {
  readonly [K in FieldKey<E>]-?: IsEqual<Pick<E, K>, Writable<Pick<E, K>>> extends true ? K : never;
}[FieldKey<E>];

/** A whole-record write as a caller supplies one: {@link EntityData} without the fields it cannot write. */
export type EntityWrite<E> = EntityData<E, WritableKey<E>>;

/** A partial write as a caller supplies one: {@link UpdatePayload} without them. */
export type UpdateWrite<E, Raw = QueryRaw> = UpdatePayload<E, Raw, WritableKey<E>>;

/** The relation names of an entity: every key but its fields and its methods, so the two sets cannot drift. */
export type RelationKey<E> = Exclude<Key<E>, FieldKey<E> | MethodKey<E>>;

/**
 * To-one relations only: a parent holds many rows of a to-many, so there is no single value to order it
 * by, and joining one in would duplicate the parent instead. Order those inside `$populate`.
 */
export type ToOneRelationKey<E> = { [K in RelationKey<E>]: IsMany<E[K]> extends true ? never : K }[RelationKey<E>];

/** The relation names a parent holds many rows of: what a populated query fills, and what an aggregate reads. */
export type ToManyRelationKey<E> = Exclude<RelationKey<E>, ToOneRelationKey<E>>;

/** Whether `T` carries the `Json` brand, read off its marker key: a primitive matches `Json<infer P>` too. */
type IsJson<T> = '__json' extends keyof T ? true : false;

/** The payload `P` of a branded `Json<P>`, or `never` for any other type. */
type UnwrapJson<T> = IsJson<T> extends true ? (T extends Json<infer P> ? P : never) : never;

/** What a JSON column declared as `V` holds, `Json<P>` or `Json<P>[]` alike; `never` on any other column. */
type JsonPayload<V, T = NonNullable<V>> = IsJson<T> extends true ? UnwrapJson<T> : UnwrapJson<NonNullable<Unpacked<T>>>;

/** Whether `V` is what a JSON column holds. */
type IsJsonColumn<V> = [JsonPayload<V>] extends [never] ? false : true;

/** The JSON columns of `E`, which an index can address. */
type JsonColumnKey<E> = { readonly [K in keyof E]-?: IsJsonColumn<E[K]> extends true ? K : never }[Key<E>];

/**
 * The JSON columns a dot-path reads into: all but one holding an array (`Json<string[]>`), which has
 * no path. `never` on an entity with none, which is most of them.
 */
type JsonFieldKey<E> = {
  readonly [K in JsonColumnKey<E>]: IsMany<JsonPayload<E[K]>> extends true ? never : K;
}[JsonColumnKey<E>];

/**
 * The dot-paths into a JSON payload: any suffix on an untyped one, none past a scalar, an array's
 * element's, and an object's keys five levels deep, below which any suffix is accepted.
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
 * The dot-paths into an entity's JSON columns: `kind?: Json<{ theme: { color: string } }>` gives
 * `'kind.theme' | 'kind.theme.color'`, `items?: Json<{ id: string }>[]` gives `'items.id'`, and an
 * untyped `Json` gives `` `kind.${string}` ``.
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

/** The value at a JSON dot-path of `E`, `unknown` where it cannot be resolved, which keeps an untyped path permissive. */
export type JsonFieldPathValue<E, P extends string> = P extends `${infer F}.${infer Rest}`
  ? F extends JsonFieldKey<E>
    ? PathValue<JsonPayload<E[F]>, Rest>
    : unknown
  : unknown;

/** The array keys of `T`, each mapped to its element type: what `$push` and `$pull` address. */
export type JsonArrayFields<T> = {
  [K in keyof T as IsMany<T[K]> extends true ? K & string : never]?: Unpacked<NonNullable<T[K]>>;
};

/**
 * A JSON field's update operators, applied `$pull`, `$set`, `$push`, `$unset` on every engine: `$set`
 * assigns top-level keys (no deep merge), `$pull` removes every equal element. See the JSON guide.
 * @example `{ kind: { $set: { public: 1 }, $push: { tags: 'x' }, $unset: ['private'] } }`
 */
export type JsonUpdateOp<T = unknown> = {
  readonly $set?: Partial<T>;
  readonly $unset?: unknown extends T ? string[] : (keyof T & string)[];
  readonly $push?: JsonArrayFields<T>;
  readonly $pull?: JsonArrayFields<T>;
};

/**
 * The {@link JsonUpdateOp} a field takes: `never` on a non-JSON field, and on a JSON array, whose
 * operators would address keys it does not have (engines disagree on what that does).
 */
type JsonUpdateOpFor<V, T = UnwrapJson<NonNullable<V>>> = [T] extends [never]
  ? never
  : IsMany<T> extends true
    ? never
    : JsonUpdateOp<T>;

/**
 * A scalar field's update operator, as {@link JsonUpdateOp} is a JSON field's, computed in the statement:
 * `$inc` adds, `$mul` multiplies, a NULL counting as 0 on every engine. One per field, since their order
 * would change the result. A `bigint` steps by a `bigint`, exactly.
 * @example `{ stock: { $inc: -1 } }`
 */
export type FieldUpdateOp<T extends number | bigint = number | bigint> = ExactlyOne<Record<'$inc' | '$mul', T>>;

/** The {@link FieldUpdateOp} a field takes: `never` on one it has no operator for, which is any but a number. */
type FieldUpdateOpFor<V> = [NonNullable<V>] extends [number]
  ? FieldUpdateOp<number>
  : [NonNullable<V>] extends [bigint]
    ? FieldUpdateOp<bigint>
    : never;

/** What an update takes beyond the value: `null` to clear an optional member, `raw` SQL, and update operators. */
type UpdateExtra<V, Raw> = (undefined extends V ? null : never) | Raw | JsonUpdateOpFor<V> | FieldUpdateOpFor<V>;

/**
 * What a whole-record write persists: the fields and relations with their declared optionality, a
 * related row's alike, and no methods. Two mapped types, since asking each key costs a conditional.
 */
export type EntityData<E, F extends keyof E = FieldKey<E>, R extends keyof E = RelationKey<E>> = {
  [P in F]: E[P];
} & {
  [P in R]: E[P] | RelationData<E[P]>;
};

/** A relation's value as its rows' {@link EntityData}. */
type RelationData<V> = V extends readonly (infer T)[] ? EntityData<T>[] : V extends object ? EntityData<V> : never;

/** {@link EntityData} made partial, each member also taking its {@link UpdateExtra}. */
export type UpdatePayload<E, Raw = QueryRaw, F extends keyof E = FieldKey<E>, R extends keyof E = RelationKey<E>> = {
  [P in F]?: E[P] | UpdateExtra<E[P], Raw>;
} & {
  [P in R]?: E[P] | RelationData<E[P]> | UpdateExtra<E[P], Raw>;
};

/** The key's name where the entity states it, by the `idKey` brand or a conventional name; `never` otherwise. */
export type NamedIdKey<E> = E extends { [idKey]?: infer K }
  ? K & FieldKey<E>
  : E extends { _id?: unknown }
    ? '_id' & FieldKey<E>
    : E extends { id?: unknown }
      ? 'id' & FieldKey<E>
      : E extends { uuid?: unknown }
        ? 'uuid' & FieldKey<E>
        : never;

/** The primary key's name, every field where the entity names none. `& string` for a generic `E`. */
export type IdKey<E> = ([NamedIdKey<E>] extends [never] ? FieldKey<E> : NamedIdKey<E>) & string;

/** The primary key's value, optional as the entity declares it: a by-id method refuses a nullish one at run time. */
export type IdValue<E> = E[IdKey<E>];

/** Whether `E`'s primary key spans several columns, which no single column can reference. */
export type HasCompositeKey<E> = true extends IsUnion<IdKey<E>> ? true : false;

/** Every column of a key, which is how a composite row is named and what a `$where` reduces to. */
type IdMap<E> = Partial<Pick<E, IdKey<E>>>;

/**
 * How a row is addressed by its primary key: the value, or a map carrying every key of a composite,
 * which is also the `$where` it reduces to. Completeness is checked at run time.
 */
export type EntityId<E> = IdValue<E> | IdMap<E>;

/** Whether `T` is a union of more than one member, which for a key means the entity's is composite. */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * The id a write reports: the value for a single key, the map for a composite. {@link EntityId} where
 * the entity names no key, since a composite cannot then be told from a single one.
 */
export type WrittenId<E> = [NamedIdKey<E>] extends [never]
  ? EntityId<E>
  : IsUnion<IdKey<E>> extends true
    ? IdMap<E>
    : IdValue<E>;

/** Every SQL column type a field may declare, by family: the unions below and `columnFamily` both read it. */
export const COLUMN_TYPES = {
  numeric: [
    'int',
    'integer',
    'tinyint',
    'smallint',
    'bigint',
    'float',
    'float4',
    'float8',
    'double',
    'double precision',
    'decimal',
    'numeric',
    'real',
  ],
  string: ['char', 'varchar', 'text', 'uuid'],
  date: ['date', 'time', 'datetime', 'timestamp', 'timestamptz'],
  json: ['json', 'jsonb'],
  blob: ['blob', 'bytea'],
  boolean: ['bool', 'boolean'],
  vector: ['vector', 'halfvec', 'sparsevec'],
} as const;

/** The kind of column a field lands on, which decides whether an option means anything on it. */
export type ColumnFamily = keyof typeof COLUMN_TYPES;

type ColumnTypeOf<F extends ColumnFamily> = (typeof COLUMN_TYPES)[F][number];

export type NumericColumnType = ColumnTypeOf<'numeric'>;
export type StringColumnType = ColumnTypeOf<'string'>;
export type DateColumnType = ColumnTypeOf<'date'>;
export type JsonColumnType = ColumnTypeOf<'json'>;
export type BlobColumnType = ColumnTypeOf<'blob'>;
export type BooleanColumnType = ColumnTypeOf<'boolean'>;
export type VectorColumnType = ColumnTypeOf<'vector'>;

/** SQL column types supported by uql migrations. */
export type ColumnType = ColumnTypeOf<ColumnFamily>;

type ColumnTypeFamily<T> = { [F in ColumnFamily]: T extends ColumnTypeOf<F> ? F : never }[ColumnFamily];

/** The family a declared `type` puts a column in, or every family where it names none. */
export type FamilyOf<T> = T extends ColumnType
  ? ColumnTypeFamily<T>
  : T extends NumberConstructor | BigIntConstructor
    ? 'numeric'
    : T extends StringConstructor
      ? 'string'
      : T extends DateConstructor
        ? 'date'
        : T extends BooleanConstructor
          ? 'boolean'
          : ColumnFamily;

/** What a field declares its `type` as: a constructor, or a column type. */
export type FieldType =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | BigIntConstructor
  | ColumnType;

/**
 * The {@link FieldType}s legal for a field declared as `V`, so `type: String` on a `number` does not
 * compile. JSON is matched on its brand, which a `Json<string>` shares with `string`, and arrays before
 * scalars, so a vector is not read as a `number`.
 */
export type TypeFor<V, T = NonNullable<V>> =
  IsJsonColumn<T> extends true
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

/** A field as the registry holds it: what was authored, plus what registration worked out, which no decorator can write. */
export type FieldMeta<V = TsTypeOf<FieldType>> = Except<FieldOptions<V>, 'computed'> & {
  /** {@link FieldOptions.computed}, a callback resolved to the SQL it returns. */
  readonly computed?: QueryRaw;
  /** Whether the column type comes from the referenced key, where the field gave `references` but no `type`. */
  readonly typeFromReference?: boolean;
};

/** A field's options, checked against `V`, the value the column holds: every scalar where the field is unknown. */
export type FieldOptions<V = TsTypeOf<FieldType>, E = unknown> = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: FieldType;
  /** A vector column's dimensions: `@Field({ type: 'vector', dimensions: 1536 })`. */
  readonly dimensions?: number;
  /**
   * The metric a vector search on this field uses unless it names its own `$distance`; by default its
   * vector index's metric, else `'cosine'`.
   */
  readonly distance?: VectorDistance;
  /** The entity this column is a foreign key to. */
  readonly references?: EntityGetter;
  /**
   * The foreign key's delete action, `@Field({ references: () => Company, onDelete: 'CASCADE' })`. A
   * relation over the column wins, and is where the update action goes: `onUpdate` here is a value callback.
   */
  readonly onDelete?: ForeignKeyAction;
  /**
   * The values the column accepts, `enum: ['draft', 'paid'] as const`: a `CHECK (col IN (...))` on every
   * SQL engine, and the property's type through the decorator, which is why they have to be `as const`.
   */
  readonly enum?: EnumValues;
  /**
   * An expression the database computes, never written: spliced into each read, or with `stored` a
   * generated column, `computed: (user) => raw`${user.first} || ' ' || ${user.last}``.
   *
   * A relation aggregate is the other form, `computed: (user) => user.resources.count()`, read as the
   * subquery a `$count` reads. Both resolve to SQL at registration, so everything downstream sees one.
   */
  readonly computed?: ComputedSql<E>;
  /** Whether {@link FieldOptions.computed} is a generated column rather than spliced into each read; no query changes either way. */
  readonly stored?: boolean;
  readonly updatable?: boolean;
  readonly eager?: boolean;
  readonly onInsert?: OnFieldCallback<V>;
  readonly onUpdate?: OnFieldCallback<V>;
  /**
   * Makes a delete stamp this field instead of removing the row, and reads skip stamped rows. `true`
   * stamps `new Date()`, anything else is the value or callback stamped, `softDelete: () => Date.now()`.
   */
  readonly softDelete?: true | OnFieldCallback<V>;

  /** The SQL type, where it differs from the one `type` implies: `type: String, columnType: 'decimal'`. */
  readonly columnType?: ColumnType;
  /** A string column's length. */
  readonly length?: number;
  /** A decimal column's precision. */
  readonly precision?: number;
  /** A decimal column's scale. */
  readonly scale?: number;
  readonly nullable?: boolean;
  readonly unique?: boolean;
  /** The column's DDL default. */
  readonly defaultValue?: DdlDefault<V>;
  /** Whether the database generates the value; a numeric sole key does unless something else fills it. */
  readonly autoIncrement?: boolean;
  /**
   * `true` for an index over the column, a string to name it. A foreign key column is indexed unless
   * this is `false`.
   */
  readonly index?: boolean | string;
  /** The column's comment in the database. */
  readonly comment?: string;
};

export type OnFieldCallback<V = TsTypeOf<FieldType>> = V | QueryRaw | (() => V | QueryRaw);

/**
 * What a column may default to: its value, or on a JSON column the SQL literal it stores, `'{}'`. The
 * erased `FieldOptions` takes both, so every field's options stay assignable to it.
 */
type DdlDefault<V, T = NonNullable<V>> =
  IsJsonColumn<T> extends true ? JsonDdlDefault : [TsTypeOf<FieldType>] extends [T] ? JsonDdlDefault | T : T;

/** What a JSON column, and the field-less `FieldOptions`, may default to. */
type JsonDdlDefault = Scalar | Record<string, unknown>;

/**
 * The TypeScript type a declared `type` implies, the inverse of {@link TypeFor}: a decorator checks the
 * property against it, `defineEntity` the other way round. `entityOptions.test-d.ts` keeps them agreeing.
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
 * {@link FieldOptions} for a field declared as `V`, `type` checked by {@link TypeFor}. A foreign key may
 * omit it, taking the referenced key's column type instead.
 */
export type FieldOptionsFor<V, E = unknown> =
  | (FieldOptions<NonNullable<V>, E> & { readonly type: TypeFor<V>; readonly isId: true })
  | (FieldOptions<NonNullable<V>, E> & { readonly type: TypeFor<V> } & DeclaresNotNull<V>)
  | (FieldOptions<NonNullable<V>, E> & {
      readonly references: EntityGetter;
      readonly type?: TypeFor<V>;
    } & DeclaresNotNull<V>)
  | AggregateOptionsFor<V, E>;

/**
 * A column holds `null` unless `nullable: false` says otherwise, and a read hydrates one, so a property
 * that does not admit it says so here. The decorators state the same rule the other way round, against
 * the property they are applied to; a key needs neither, being NOT NULL on every engine.
 */
type DeclaresNotNull<V> = null extends V ? unknown : { readonly nullable: false };

/**
 * A field a relation aggregate computes: the aggregate types it, so it declares no `type`, and only the
 * two a row change turns into a delta - `count` and `sum` - may be `stored`.
 */
type AggregateOptionsFor<V, E> = Except<FieldOptions<NonNullable<V>, E>, 'computed' | 'stored' | 'type'> &
  (
    | { readonly computed: AggregateReading<E, V, boolean>; readonly stored?: false }
    | { readonly computed: AggregateReading<E, V, true>; readonly stored: true }
  );

/** An aggregate reading what the property holds, bivariant the way {@link EntitySql} is. */
type AggregateReading<E, V, S extends boolean> = {
  agg(refs: ComputedRefs<E>): RelationAggregate<null extends V ? NonNullable<V> | null : NonNullable<V>, S>;
}['agg'];

/** The entity a relation points at: `Company` for `company?: Company` and `companies?: Company[]` alike. */
export type RelationTarget<V> = Extract<Unpacked<V>, object>;

/**
 * {@link RelationOptions} for a relation declared as `V`, keyed on the `cardinality` its shape allows: a
 * key rather than a conditional, which is what types a `mappedBy` callback inside `defineEntity`.
 */
export type RelationOptionsFor<V, O = unknown> = {
  readonly cardinality: IsMany<V> extends true ? '1m' | 'mm' : '11' | 'm1';
} & (
  | ({ readonly cardinality: '11' } & RelationOneToOneOptions<RelationTarget<V>, O>)
  | ({ readonly cardinality: 'm1' } & RelationManyToOneOptions<RelationTarget<V>, O>)
  | ({ readonly cardinality: '1m' } & RelationOneToManyOptions<RelationTarget<V>, O>)
  | ({ readonly cardinality: 'mm' } & RelationManyToManyOptions<RelationTarget<V>, O>)
);

/** The method names of an entity, which a hook registration names. */
export type MethodKey<E> = {
  readonly [K in keyof E]-?: NonNullable<E[K]> extends (...args: never[]) => unknown ? K : never;
}[Key<E>];

/**
 * An entity class read later, `() => Company`: a decorator runs before its class is bound, so a
 * self-reference or a circular import would otherwise throw.
 */
export type EntityGetter<E = object> = () => Type<E>;

export type CascadeType = 'persist' | 'delete';

/**
 * `E` is the relation's target and `O` the entity declaring it, whose fields `references` names on its
 * `local` side; the relation decorators infer `O` from the class they sit on.
 */
export type RelationOptions<E, O = unknown> = {
  entity: EntityGetter<E>;
  cardinality: RelationCardinality;
  readonly cascade?: boolean | CascadeType;
  /**
   * The foreign key's delete action, the database's alternative to `cascade`, read on the owning side;
   * unset, the column's own `@Field({ onDelete })` applies.
   */
  readonly onDelete?: ForeignKeyAction;
  readonly onUpdate?: ForeignKeyAction;
  /** The inverse side: the member of the target holding the foreign key or the owning relation, `(post) => post.author`. */
  mappedBy?: (keys: KeyMap<E>) => RelationKey<E> | ForeignKey<E, O>;
  /** The junction entity of a many-to-many, holding a foreign key to each side. */
  through?: EntityGetter;
  /**
   * The join columns: a to-one's foreign key, `(post) => post.authorId`, or pairs where no key fits,
   * `(order, customer) => [{ local: order.customerCode, foreign: customer.code }]`. Not with `through`.
   */
  references?: (local: KeyMap<O>, foreign: KeyMap<E>) => ForeignKey<O, E> | readonly RelationReference<O, E>[];
};

/** The one column of `O` that can be a foreign key to `E`: a field holding `E`'s key, which has to be a single one. */
type ForeignKey<O, E> = HasCompositeKey<E> extends true ? never : FieldKeyHolding<O, IdValue<E>>;

/** One pair of join columns, each a field read off its entity's key map, the local one holding the foreign's value. */
export type RelationReference<O, E> = {
  readonly [F in keyof E]-?: { readonly local: FieldKeyHolding<O, E[F]>; readonly foreign: F };
}[FieldKey<E>];

/** The fields of `O` that can hold any value `V` takes. */
type FieldKeyHolding<O, V> = {
  readonly [K in keyof O]-?: [NonNullable<V>] extends [NonNullable<O[K]>] ? K : never;
}[FieldKey<O>];

/** {@link RelationOptions.references} as pairs alone, for a to-many, which holds no foreign key of its own to name. */
type RelationReferencePairs<E, O> = (local: KeyMap<O>, foreign: KeyMap<E>) => readonly RelationReference<O, E>[];

/** A relation once `getMeta` resolved it: `references` settled into pairs and `mappedBy` a name. */
export type RelationMeta = Omit<RelationRegistration, 'references'> & { references: RelationReferences };

/**
 * A relation as the registry takes it: `mappedBy` and `references` read down to names, `references` a
 * single column until `getMeta` pairs it with the target's key.
 */
export type RelationRegistration = Omit<RelationOptions<object>, 'mappedBy' | 'references'> & {
  mappedBy?: string;
  references?: RelationReferences | string;
};

/** How a to-many owner reaches its children: a junction entity or the join columns, never both. */
type RelationOwnerJoin<E, O> =
  | (Required<Pick<RelationOptions<E, O>, 'through'>> & { readonly references?: never })
  | { readonly references: RelationReferencePairs<E, O>; readonly through?: never };

/** The side holding the foreign key, which `references` names and the actions attach to. */
type RelationOptionsOwner<E, O> = Pick<RelationOptions<E, O>, 'entity' | 'cascade' | 'onDelete' | 'onUpdate'> &
  Required<Pick<RelationOptions<E, O>, 'references'>>;
type RelationOptionsInverseSide<E, O> = Pick<RelationOptions<E, O>, 'entity' | 'cascade'> &
  Required<Pick<RelationOptions<E, O>, 'mappedBy'>>;
type RelationOptionsThroughOwner<E, O> = Pick<RelationOptions<E, O>, 'entity' | 'cascade'> & RelationOwnerJoin<E, O>;

/** The key names of `E` as values, so a definition reads a member off it, `(post) => post.author`, and follows a rename. */
export type KeyMap<E> = { readonly [K in keyof E]-?: K };

/** The fields of `E` as {@link ColumnRef}s, for SQL that names them: `refs(User)`, or a definition's callback. */
export type RefMap<E, F extends keyof E = FieldKey<E>> = { readonly [K in F]-?: ColumnRef<K & string> };

/** SQL a definition writes: `raw`, or a callback reading the fields off its refs, bivariant so the registry can hold it. */
export type EntitySql<E> = QueryRaw | { sql(refs: RefMap<E>): QueryRaw }['sql'];

/** The fields of `C` a `sum` or an `avg` can add up. */
type NumericKey<C> = {
  readonly [K in FieldKey<C>]-?: [NonNullable<C[K]>] extends [number | bigint] ? K : never;
}[FieldKey<C>];

/** One field of `C`, read off its refs: `(item) => item.amount`. */
type PickRef<C, K extends keyof C> = (refs: RefMap<C>) => ColumnRef<K & string>;

/**
 * A relation as a `computed` field reads it, its aggregates typed against the related entity. `count`
 * and `sum` are the two a row change turns into a delta, so they alone may be `stored`; the rest read
 * as a subquery and are `null` where the relation holds no row.
 */
export type RelationRef<C> = {
  count(q?: AggregateFilter<C>): RelationAggregate<number, true>;
  count(q: AggregatePage<C>): RelationAggregate<number, false>;
  sum<K extends NumericKey<C>>(pick: PickRef<C, K>, q?: AggregateFilter<C>): RelationAggregate<NonNullable<C[K]>, true>;
  sum<K extends NumericKey<C>>(
    pick: PickRef<C, K>,
    q: AggregateTopRows<C>,
  ): RelationAggregate<NonNullable<C[K]>, false>;
  min<K extends FieldKey<C>>(
    pick: PickRef<C, K>,
    q?: AggregateRows<C>,
  ): RelationAggregate<NonNullable<C[K]> | null, false>;
  max<K extends FieldKey<C>>(
    pick: PickRef<C, K>,
    q?: AggregateRows<C>,
  ): RelationAggregate<NonNullable<C[K]> | null, false>;
  avg<K extends NumericKey<C>>(pick: PickRef<C, K>, q?: AggregateRows<C>): RelationAggregate<number | null, false>;
};

/**
 * What an aggregate reads of the related rows. The predicate is an {@link EntityPredicate} rather than a
 * full `$where` so that `stored: true` changes no call site: a trigger sees one row, and can evaluate
 * nothing that traverses a relation or opens a subquery.
 */
export type AggregateFilter<C> = { readonly $where?: EntityPredicate<C> };

/**
 * A tally capped to a page of the related rows, as `count` itself takes one. It needs no `$sort` and
 * accepts none: an order picks *which* rows a page holds, never how many.
 */
export type AggregatePage<C> = AggregateFilter<C> & Pick<RelationQuery<C>, '$limit' | '$skip'>;

/**
 * The rows a value aggregate reads where it reads only some of them - "the five largest" - which only
 * an order defines, so `$sort` and `$limit` come together. Keyed off the relation read they are, so
 * the page an aggregate takes and the page a `$populate` takes cannot drift apart.
 */
export type AggregateTopRows<C> = AggregateFilter<C> &
  Required<Pick<RelationQuery<C>, '$sort' | '$limit'>> &
  Pick<RelationQuery<C>, '$skip'>;

/** Either of those, for the aggregates that are never `stored` and so need no second signature. */
export type AggregateRows<C> = AggregateFilter<C> | AggregateTopRows<C>;

/** What a `computed` callback reads: the entity's fields as columns, its to-many relations as aggregates. */
export type ComputedRefs<E, F extends keyof E = FieldKey<E>, R extends keyof E = ToManyRelationKey<E>> = RefMap<
  E,
  F
> & {
  readonly [K in R]-?: RelationRef<RelationTarget<E[K]>>;
};

/** A relation aggregate a definition writes, bivariant the way {@link EntitySql} is. */
export type EntityAggregate<E> = { agg(refs: ComputedRefs<E>): RelationAggregate }['agg'];

/**
 * SQL a `computed` field writes. One callback shape for every arm, aggregate or not: overload
 * resolution picks a contextual parameter type per arm only while they agree on one.
 */
export type ComputedSql<E> = QueryRaw | { sql(refs: ComputedRefs<E>): QueryRaw }['sql'];

/** The value a field's options declare it holds, where an aggregate is what declares it. */
export type AggregateValue<O> = O extends { readonly computed: (...args: never[]) => RelationAggregate<infer V> }
  ? V
  : never;

/** A predicate DDL can hold: the entity's own fields, without a relation, `$text` or a sub-query. */
export type EntityPredicate<E> = QueryWhere<E> & { readonly [K in RelationKey<E>]?: never } & {
  readonly $text?: never;
  readonly $exists?: never;
  readonly $nexists?: never;
};

/** A definition's predicate: an {@link EntityPredicate}, or {@link EntitySql} for what one cannot say. */
export type EntityWhere<E> = EntityPredicate<E> | EntitySql<E>;

/** A definition's predicate as metadata keeps it, a callback resolved to its SQL, for the schema build to compile. */
export type EntityWhereMeta<E> = EntityPredicate<E> | QueryRaw;

export type RelationReferences = { readonly local: string; readonly foreign: string }[];

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E, O = unknown> = RelationOptionsOwner<E, O> | RelationOptionsInverseSide<E, O>;

export type RelationOneToManyOptions<E, O = unknown> =
  | RelationOptionsInverseSide<E, O>
  | RelationOptionsThroughOwner<E, O>;

export type RelationManyToOneOptions<E, O = unknown> = RelationOptionsOwner<E, O>;

export type RelationManyToManyOptions<E, O = unknown> =
  | RelationOptionsThroughOwner<E, O>
  | RelationOptionsInverseSide<E, O>;

/** The lifecycle events. An upsert has its own pair: which branch a row takes is the database's to decide. */
export type HookEvent =
  | 'beforeInsert'
  | 'afterInsert'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeUpsert'
  | 'afterUpsert'
  | 'beforeDelete'
  | 'afterDelete'
  | 'afterLoad';

/** A registered hook: the entity's method to call. */
export type HookRegistration = {
  readonly methodName: string;
};

/**
 * An index type with what it needs: a vector index has to name its metric, since engines default to a
 * different one than the queries use; an Atlas `vectorSearch` index may, else takes its field's, else
 * cosine; a `fulltext` one may name the text-search `config` it parses with; and any other index neither.
 */
export type IndexTypeOptions =
  | { type: VectorIndexType; distance: VectorDistance; config?: never }
  | { type: 'vectorSearch'; distance?: VectorDistance; config?: never }
  | { type: 'fulltext'; distance?: never; config?: string }
  | { type?: Exclude<IndexType, VectorIndexType | 'vectorSearch' | 'fulltext'>; distance?: never; config?: never };

/** One index entry as the migration builder takes it: a column name, `raw`, or an object when it needs more. */
export type IndexColumnInput = string | QueryRaw | EntityIndexColumn;

/**
 * One entry of an entity's index, read off its refs: a column, `raw`, or an object when it needs more.
 * @example `@Index((post) => [post.tenantId, { column: post.createdAt, order: 'desc' }, raw`lower(${post.email})`])`
 */
export type EntityIndexColumnInput<E> = QueryRaw | IndexColumnOptions | IndexJsonColumnOptions<E>;

/** A JSON entry, its `path` checked against its own column's payload: a misspelled one builds an index nothing uses. */
type IndexJsonColumnOptions<E> = {
  [K in JsonColumnKey<E>]: IndexColumnPlainModifiers & { readonly column: ColumnRef<K & string> } & (
      | { readonly jsonPath: WithCheckedPath<IndexJsonPath, E, K>; readonly jsonArray?: never }
      | { readonly jsonArray: WithCheckedPath<IndexJsonArray, E, K>; readonly jsonPath?: never }
    );
}[JsonColumnKey<E>];

/** A JSON modifier with its `path` narrowed to the column's payload, everything else taken from `T` as declared. */
type WithCheckedPath<T extends { path?: string }, E, K extends Key<E>> = Except<T, 'path' & keyof T> & {
  [P in keyof Pick<T, Extract<keyof T, 'path'>>]: DeepJsonKeys<JsonPayload<E[K]>>;
};

/** What an index entry carries besides its column, shared by the authored and the normalized entry. */
export type IndexColumnModifiers = {
  /** Index only the first `n` characters, which the MySQL family requires on a `TEXT` or `BLOB` column. */
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
 * An index over a path inside a JSON column, spelled as the `$where` on it compiles, which is how the
 * planner matches the two. `type` is how the queries compare it.
 * @example `@Index((user) => [{ column: user.kind, jsonPath: { path: 'rating', type: Number } }])`
 */
export type IndexJsonPath = {
  /** The path inside the column, spelled as a `$where` key spells it: `'theme.color'`. */
  readonly path: string;
  /** How the value is read, matching what the queries over it compare against. */
  readonly type: FieldType;
  /** Length of a string value, which MySQL keys as `CHAR(n)` and so requires. */
  readonly length?: number;
};

/**
 * MySQL's multi-valued index, one key per element of the JSON array at `path`, which `$all` and an
 * `$elemMatch` on one value or several use; refused on any other engine.
 * @example `@Index((user) => [{ column: user.tags, jsonArray: { type: String, length: 64 } }])`
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

/** An entity's entry with plain modifiers, never a JSON one, whose path would then go unchecked. */
type IndexColumnOptions = IndexColumnPlainModifiers & {
  /** A column read off the refs, or `raw` for an expression. */
  readonly column: QueryRaw;
  readonly jsonPath?: never;
  readonly jsonArray?: never;
};

/** One index entry, normalized, as every dialect and generator reads it. */
export type IndexColumnSchema = IndexColumnModifiers & {
  /** A column name, or raw SQL when {@link expression} is set. */
  readonly column: string;
  /** Whether {@link column} is an expression to emit as-is rather than an identifier to quote. */
  readonly expression?: boolean;
};

/** One index entry as metadata keeps it: a member, or an expression rendered when the schema is built. */
export type EntityIndexColumn = IndexColumnModifiers & { readonly column: string | QueryRaw };

/** An index as metadata keeps it. */
export type EntityIndexMeta<E = object> = {
  /** The indexed columns, in order. */
  columns: readonly EntityIndexColumn[];
  /** Custom index name */
  name?: string;
  /** Whether index is unique; omit or `false` for a non-unique index (default). */
  unique?: boolean;
  /** Partial index predicate, compiled when the schema is built. */
  where?: EntityWhereMeta<E>;
  /** Columns stored in the index beyond its key, so a query reading only these needs no row. Postgres-wire only. */
  include?: readonly string[];
} & VectorIndexOptions &
  IndexTypeOptions;

export type EntityMeta<E> = {
  readonly entity: Type<E>;
  /** The table, which is the class's own name where the entity named none - see {@link derivedName}. */
  name?: string;
  /** Whether {@link name} came from the class rather than from the author, so a naming strategy applies. */
  derivedName?: boolean;
  /** Set only when the entity named one; unset defers to the pool where it is used. See `AbstractDialect.resolveSchema`. */
  schema?: string;
  /** Every column of the primary key, in declaration order. */
  ids: readonly IdKey<E>[];
  softDelete?: FieldKey<E>;
  /** Named, default-on `$where` filters applied to every query unless bypassed. */
  filters?: Record<string, FilterOptions<E>>;
  fields: {
    [K in FieldKey<E>]?: FieldMeta;
  } & { [key: string]: FieldMeta | undefined };
  relations: {
    [K in RelationKey<E>]?: RelationMeta;
  } & { [key: string]: RelationMeta | undefined };
  /** Composite indexes defined via @Index decorator */
  indexes?: EntityIndexMeta<E>[];
  /** `CHECK` constraints, compiled when the schema is built. */
  checks?: EntityCheckMeta<E>[];
  /** Lifecycle hooks registered via @BeforeInsert, @AfterUpdate, etc. */
  hooks?: Partial<Record<HookEvent, HookRegistration[]>>;
  /** Bumped by every `define*` call, so what is derived from the metadata can tell it changed. */
  revision: number;
  /** The revision `getMeta` last finalized, which is what makes finalizing idempotent and re-entrant. */
  processedAt?: number;
};

/**
 * A table's `CHECK`, `{ where: { balance: { $gte: 0 } } }`, or SQL off the refs,
 * `{ where: (wallet) => raw`${wallet.spent} <= ${wallet.balance}` }`.
 */
export type CheckOptions<E = unknown> = {
  /** Derived from the table and the constraint's position when absent. */
  readonly name?: string;
  readonly where: EntityWhere<E>;
};

/** A `CHECK` as entity metadata keeps it, its callback resolved. */
export type EntityCheckMeta<E = object> = {
  readonly name?: string;
  readonly where: EntityWhereMeta<E>;
};

/** An entity's members as the registry takes them, keyed by name: what decorators and `defineEntity` both reduce to. */
export type EntityMembers = {
  readonly fields?: Readonly<Record<string, FieldOptions | undefined>>;
  readonly relations?: Readonly<Record<string, RelationRegistration | undefined>>;
  readonly hooks?: Readonly<Partial<Record<HookEvent, readonly string[]>>>;
};

/** An entity's fields as `defineEntity` takes them, keyed like every entity map (see `QuerySelect`). */
type EntityFieldOptions<E, F extends keyof E = FieldKey<E>> = { readonly [K in F]?: FieldOptionsFor<E[K], E> };

/** An entity's relations as `defineEntity` takes them, keyed over every member: only that types a `mappedBy` callback. */
type EntityRelationOptions<E> = { readonly [K in keyof E]?: RelationOptionsFor<E[K], E> };

/** An entity's options, `@Entity()` or `defineEntity`; the members too where no decorator declares them. */
export type EntityOptions<E = unknown> = {
  readonly name?: string;
  /** A base to inherit members from, for a class that cannot extend it; its real base, if any, wins. See the Inheritance guide. */
  readonly extends?: string extends keyof E ? Type<object> : Type<Partial<E>>;
  /** The schema (a MySQL database) the table lives in; unset follows the pool's. */
  readonly schema?: string;
  /** Named, default-on `$where` filters (soft-delete is auto-registered from `@Field({ softDelete })`). */
  readonly filters?: Record<string, FilterOptions<E>> & { readonly [SOFT_DELETE_FILTER]?: never };
  /** Scalar fields; use `isId: true` on exactly one field for the primary key. */
  readonly fields?: EntityFieldOptions<E>;
  readonly relations?: EntityRelationOptions<E>;
  readonly indexes?: readonly EntityIndexInput<E>[];
  /** Table-level `CHECK` constraints. See {@link CheckOptions}. */
  readonly checks?: readonly CheckOptions<E>[];
  /** Each lifecycle event and the methods it runs, read off the key map: `{ beforeInsert: (post) => [post.stamp] }`. */
  readonly hooks?: Partial<Record<HookEvent, (keys: KeyMap<E>) => readonly MethodKey<E>[]>>;
};

/**
 * Everything an index carries beyond its columns, as the migration builder's `table.index(...)` takes it,
 * and through {@link EntityIndexOptions} `@Index` and `defineEntity`. `Except` (not plain `Omit`) keeps
 * `type`/`distance` a discriminated pair: omitting `distance` on a vector index type is a compile error.
 */
export type IndexOptions = Except<EntityIndexMeta, 'columns' | 'where'> & {
  /** Partial-index predicate, as `raw` with no interpolation: the migration builder has no entity to compile one against. */
  readonly where?: QueryRaw;
};

/**
 * {@link IndexOptions} on an entity, whose stored columns are read off its refs, `(post) => [post.slug]`,
 * so they are checked against it and follow a rename. The migration builder names raw columns instead.
 */
export type EntityIndexOptions<E> = Except<IndexOptions, 'include' | 'where'> & {
  readonly include?: (refs: RefMap<E>) => readonly ColumnRef<FieldKey<E>>[];
  /** Partial-index predicate. See {@link EntityWhere}. */
  readonly where?: EntityWhere<E>;
};

/**
 * An index as authored on an entity, before `defineIndex` reads its columns off the refs. Only the
 * member lists are callbacks: TypeScript never checks a callback's returned literal for excess properties,
 * so the options stay a literal of their own, where `uniqe: true` is a compile error.
 */
export type EntityIndexInput<E> = EntityIndexOptions<E> & {
  readonly columns: (refs: RefMap<E>) => readonly EntityIndexColumnInput<E>[];
};
