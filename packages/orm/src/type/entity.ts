import type { EnumValues, ForeignKeyAction, IndexType } from '../schema/types.js';
import type { SqlDialectName } from './dialect.js';
import type { Querier } from './querier.js';
import type { FilterOptions, RelationQuery } from './query.js';
import type { ColumnRef, JsonPathRef, QuerySql, SqlFor, RelationAggregate } from './querySql.js';
import type { QueryWhere } from './queryWhere.js';
import type { StandardSchemaV1 } from './standardSchema.js';
import type {
  AtLeastOne,
  ExactlyOne,
  IsEqual,
  Merge,
  IsJson,
  JsonBrand,
  IsMany,
  Json,
  JsonScalar,
  Scalar,
  Type,
  AbstractType,
  Unpacked,
  Writable,
} from './utility.js';
import type { VectorDistance, VectorIndexOptions, VectorIndexType } from './vector.js';

/** Brands the property an entity is identified by, where it is not `id`, `_id` or `uuid`. */
export const idKey = Symbol('idKey');

/**
 * Brands the property holding an entity's optimistic-lock version, which is what makes an update
 * payload require it. No conventional name, unlike {@link idKey}: a field merely called `version`
 * must not start demanding one.
 */
export const versionKey = Symbol('versionKey');

/** Brands the fields an insert may leave out, which a default fills, `[filledKey]?: 'units' | 'createdAt'`; each stays present on every read. */
export const filledKey = Symbol('filledKey');

export type EntityBrand = typeof idKey | typeof versionKey | typeof filledKey;

/** The names an entity's brand `B` lists, `never` where it declares none. */
export type BrandNames<E, B extends EntityBrand> = B extends keyof E ? NonNullable<E[B]> : never;

/**
 * A brand naming a key that is no field, which each reader would drop silently: refused where an entity
 * registers, `@Entity()`, by a member the class lacks that names the typo. A class with no
 * members matches every optional brand, so only one declaring a brand is read.
 */
export type BrandsNameFields<E> = {
  readonly [
    N in Exclude<[EntityBrand & keyof E] extends [never] ? never : BrandNames<E, EntityBrand>, FieldKey<E>> &
      string as `brand names '${N}', which is no field`
  ]: never;
};

/** The filter a `softDelete()` column registers, a name reserved against an entity's own filters. */
export const SOFT_DELETE_FILTER = 'softDelete';

/** The key names of an entity. */
export type Key<E> = keyof E & string;

/**
 * The field names of an entity: scalars, scalar arrays (a vector) and JSON, including a list of JSON
 * documents, whose brand sits on the element. The check is bracketed so `any` lands on one side, and a
 * class is kept off the `Json` arm by the weak-type check.
 */
export type FieldKey<E> = {
  readonly [K in keyof E]-?: [NonNullable<E[K]>] extends [Scalar | readonly Scalar[] | JsonBrand | readonly JsonBrand[]]
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

/**
 * What an insert may leave out however the entity declares it: a single-column key, which something
 * usually generates, the version, which uql starts at 0, and what {@link filledKey} lists. A composite
 * key is the references a row is made of, so an insert names it.
 */
type FilledKey<E> = SoleIdKey<E> | VersionKey<E> | (BrandNames<E, typeof filledKey> & FieldKey<E>);

/**
 * A whole-record write as a caller supplies one: {@link EntityData} without the fields it cannot write,
 * a {@link FilledKey} optional. That part is a conditional, which TypeScript leaves shut while it types a
 * call's payload against the generic write: as a mapped type, it doubled what checking an insert cost.
 */
export type EntityWrite<E> = EntityData<E, Exclude<WritableKey<E>, FilledKey<E>>> &
  ([FilledKey<E>] extends [never] ? unknown : { [P in WritableKey<E> & FilledKey<E>]?: E[P] });

/** A row a trigger's body writes: each writable field its value, or SQL - a row's ref most often. */
export type WriteRow<E, F extends keyof E = WritableKey<E>> = { readonly [K in F]?: E[K] | SqlFor<QuerySql, E[K]> };

/**
 * The property an entity brands with {@link versionKey} as its optimistic lock, `never` where it
 * brands none. The brand is what carries `f.version()` to the type level, since a
 * decorator's options never reach `E`.
 */
export type VersionKey<E> = E extends { [versionKey]?: infer K } ? K & FieldKey<E> : never;

/**
 * A partial write as a caller supplies one: {@link UpdatePayload} without the fields it cannot write,
 * and with the version where the entity keeps one - a write that cannot say which row state it read
 * is refused here rather than silently overwriting whatever is there now.
 */
export type UpdateWrite<E, Sql = QuerySql> = UpdatePayload<E, Sql, WritableKey<E>> & Required<Pick<E, VersionKey<E>>>;

/** The relation names of an entity: every key but its fields and its methods, so the two sets cannot drift. */
export type RelationKey<E> = Exclude<Key<E>, FieldKey<E> | MethodKey<E>>;

/**
 * To-one relations only: a parent holds many rows of a to-many, so there is no single value to order it
 * by, and joining one in would duplicate the parent instead. Order those inside `$populate`.
 */
export type ToOneRelationKey<E> = { [K in RelationKey<E>]: IsMany<E[K]> extends true ? never : K }[RelationKey<E>];

/** The relation names a parent holds many rows of: what a populated query fills, and what an aggregate reads. */
export type ToManyRelationKey<E> = Exclude<RelationKey<E>, ToOneRelationKey<E>>;

/** The payload `P` of a branded `Json<P>`, `unknown` for a bare `Json`, which any path reads into, or `never` for any other type. */
type UnwrapJson<T> =
  IsJson<T> extends true ? (IsEqual<T, Json> extends true ? unknown : T extends Json<infer P> ? P : never) : never;

/** What a JSON column declared as `V` holds, `Json<P>` or `Json<P>[]` alike; `never` on any other column. */
type JsonPayload<V, T = NonNullable<V>> = IsJson<T> extends true ? UnwrapJson<T> : UnwrapJson<NonNullable<Unpacked<T>>>;

/** Whether `V` is what a JSON column holds. */
type IsJsonColumn<V> = [JsonPayload<V>] extends [never] ? false : true;

/** The JSON columns of `E`. */
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
 * element's unless `Arrays` is false, and an object's keys five levels deep, below which any suffix is accepted.
 */
type DeepJsonKeys<T, D extends unknown[] = [], Arrays = true> = unknown extends T
  ? string
  : NonNullable<T> extends Scalar
    ? never
    : NonNullable<T> extends readonly (infer U)[]
      ? Arrays extends true
        ? DeepJsonKeys<U, D, Arrays>
        : never
      : D['length'] extends 5
        ? string
        : {
            [K in keyof NonNullable<T> & string]:
              | K
              | `${K}.${DeepJsonKeys<NonNullable<T>[K], [...D, unknown], Arrays>}`;
          }[keyof NonNullable<T> & string];

/** The dotted paths into `T`'s nested objects, never through an array: what a dotted `$set` and `$unset` name. */
type JsonNestedPaths<T> = Extract<DeepJsonKeys<T, [], false>, `${string}.${string}`>;

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

/** The keys of `T` holding an array, each mapped to its element type: what `$push` and `$pull` address. */
export type JsonArrayFields<T> = {
  [K in keyof T as IsMany<T[K]> extends true ? K & string : never]?: Unpacked<NonNullable<T[K]>>;
};

/** The keys of `T` holding an array with an element `$addToSet` takes, each mapped to that element. */
type JsonSetFields<T> = {
  [
    K in keyof T as IsMany<T[K]> extends true
      ? [JsonSetElement<Unpacked<NonNullable<T[K]>>>] extends [never]
        ? never
        : K & string
      : never
  ]?: JsonSetElement<Unpacked<NonNullable<T[K]>>>;
};

/**
 * A JSON field's update operators, applied in order on every engine, `$pull`, `$set`, `$push`, `$addToSet`,
 * `$unset`, each seeing what the one before wrote; see the JSON guide.
 * @example `{ kind: { $set: { public: 1 }, $push: { tags: 'x' }, $unset: ['private'] } }`
 */
export type JsonUpdateOp<T = unknown> = {
  readonly $set?: Partial<T> & { readonly [P in JsonNestedPaths<T>]?: PathValue<T, P> };
  readonly $unset?: unknown extends T ? readonly string[] : readonly ((keyof T & string) | JsonNestedPaths<T>)[];
  readonly $push?: JsonArrayFields<T>;
  readonly $pull?: JsonArrayFields<T>;
  readonly $addToSet?: JsonSetFields<T>;
};

/**
 * A JSON array column's update operators, each taking a list of elements, applied in order on every engine:
 * `$pull` each, `$push` each, then `$addToSet` each the array lacks. A NULL column counts as an empty array,
 * and a stored value that is no array stays as it is.
 * @example `{ tags: { $pull: ['stale'], $addToSet: ['new'] } }`
 */
export type JsonArrayUpdateOp<T = unknown> = {
  readonly $pull?: readonly T[];
  readonly $push?: readonly T[];
  readonly $addToSet?: readonly JsonSetElement<T>[];
};

/** What `$addToSet` takes from an array of `T`: its scalars, any scalar where `T` is untyped. */
type JsonSetElement<T> = unknown extends T ? JsonScalar : Extract<T, JsonScalar>;

/**
 * The update operators a field takes: {@link JsonArrayUpdateOp} on a JSON array, `Json<T[]>` or `Json<T>[]`,
 * {@link JsonUpdateOp} on any other JSON field, and `never` on a field that is no JSON.
 */
type JsonUpdateOpFor<V, T = UnwrapJson<NonNullable<V>>> = [T] extends [never]
  ? IsJsonColumn<V> extends true
    ? JsonArrayUpdateOp<JsonPayload<V>>
    : never
  : IsMany<T> extends true
    ? JsonArrayUpdateOp<Unpacked<T>>
    : JsonUpdateOp<T>;

/**
 * A scalar field's update operator, as {@link JsonUpdateOp} is a JSON field's, computed in the statement:
 * `$inc` adds, `$mul` multiplies, a NULL counting as 0 on every engine. One per field, since their order
 * would change the result. A `bigint` steps by a `bigint`, exactly, and the step may be SQL of the field's type.
 * @example `{ stock: { $inc: -1 } }`, `{ total: { $inc: newRow.amount } }`
 */
export type FieldUpdateOp<T = number | bigint | QuerySql> = ExactlyOne<Record<'$inc' | '$mul', T>>;

/** The {@link FieldUpdateOp} a field takes: `never` on one it has no operator for, which is any but a number. */
type FieldUpdateOpFor<V, Sql> = [NonNullable<V>] extends [number]
  ? FieldUpdateOp<number | SqlFor<Sql, number>>
  : [NonNullable<V>] extends [bigint]
    ? FieldUpdateOp<bigint | SqlFor<Sql, bigint>>
    : never;

/** What an update takes beyond the value: `null` to clear an optional member, `sql` SQL, and update operators. */
type UpdateExtra<V, Sql> =
  | (undefined extends V ? null : never)
  | SqlFor<Sql, V>
  | JsonUpdateOpFor<V>
  | FieldUpdateOpFor<V, Sql>;

/**
 * What a whole-record write persists: the fields and relations with their declared optionality, a
 * related row as a caller writes one, and no methods. Two mapped types, since asking each key costs a
 * conditional.
 */
export type EntityData<E, F extends keyof E = FieldKey<E>, R extends keyof E = RelationKey<E>> = {
  [P in F]: E[P];
} & {
  [P in R]: E[P] | RelationData<E[P]>;
};

/** A relation's value as its rows' {@link EntityWrite}. */
type RelationData<V> = V extends readonly (infer T)[] ? EntityWrite<T>[] : V extends object ? EntityWrite<V> : never;

/** {@link EntityData} made partial, each member also taking its {@link UpdateExtra}. */
export type UpdatePayload<E, Sql = QuerySql, F extends keyof E = FieldKey<E>, R extends keyof E = RelationKey<E>> = {
  [P in F]?: E[P] | UpdateExtra<E[P], Sql>;
} & {
  [P in R]?: E[P] | RelationData<E[P]> | UpdateExtra<E[P], Sql>;
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

/**
 * The key an entity names where it is one column, as `soleIdOf` reads it at run time; `never` for a
 * composite and for no named key, which {@link HasCompositeKey} tells apart where a reference needs it.
 */
type SoleIdKey<E> = true extends IsUnion<NamedIdKey<E>> ? never : NamedIdKey<E>;

/** Every column of a key, which is how a composite row is named and what a `$where` reduces to. */
type IdMap<E> = Partial<Pick<E, IdKey<E>>>;

/**
 * How a row is addressed by its primary key: the value, or a map carrying every key of a composite,
 * which is also the `$where` it reduces to. Completeness is checked at run time.
 */
export type EntityId<E> = IdValue<E> | IdMap<E>;

/** Whether `T` is a union of more than one member, which for a key means the entity's is composite. */
export type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * The id a write reports: the value for a single key, the map for a composite. {@link EntityId} where
 * the entity names no key, since a composite cannot then be told from a single one.
 */
export type WrittenId<E> = [NamedIdKey<E>] extends [never]
  ? EntityId<E>
  : [SoleIdKey<E>] extends [never]
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

/** A date column holding a time of day, which names no day: every driver reads it back as text, never a `Date`. */
type TimeColumnType = 'time';

/** A numeric column holding an exact decimal, read as its text: a JS number would round it. */
type DecimalColumnType = 'decimal' | 'numeric';
export type JsonColumnType = ColumnTypeOf<'json'>;

export type BlobColumnType = ColumnTypeOf<'blob'>;
export type BooleanColumnType = ColumnTypeOf<'boolean'>;
export type VectorColumnType = ColumnTypeOf<'vector'>;

/** SQL column types supported by uql migrations. */
export type ColumnType = ColumnTypeOf<ColumnFamily>;

/** What a field declares its `type` as: a constructor, or a column type. */
export type FieldType =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | BigIntConstructor
  | ColumnType;

/** A field as the registry holds it: what was authored, plus what registration worked out, which no decorator can write. */
export type FieldMeta<V = unknown> = FieldOptions<V> & {
  /** Whether the column type comes from the referenced key, where the field gave `references` but no `type`. */
  readonly typeFromReference?: boolean;
};

/** A field's options, checked against `V`, the value the column holds: every scalar where the field is unknown. */
export type FieldOptions<V = unknown> = {
  readonly name?: string;
  readonly isId?: true;
  readonly type?: FieldType;
  /** A vector column's dimensions: `f.vector(1536)`. */
  readonly dimensions?: number;
  /**
   * The metric a vector search on this field uses unless it names its own `$distance`; by default its
   * vector index's metric, else `'cosine'`. Where both name one, they must agree.
   */
  readonly distance?: VectorDistance;
  /** The entity this column is a foreign key to. */
  readonly references?: EntityGetter;
  /**
   * The foreign key's delete action, `f.references(() => Company).onDelete('CASCADE')`. A
   * relation over the column wins, and is where the update action goes: `onUpdate` here is a value callback.
   */
  readonly onDelete?: ForeignKeyAction;
  /** The values the column accepts, `f.enum(['draft', 'paid'])`: a `CHECK (col IN (...))` on every SQL engine. */
  readonly enum?: EnumValues;
  /** A JSON column's payload as a Standard Schema, `f.json(schema)`, typed by its output and never read at run time. */
  readonly schema?: StandardSchemaV1;
  /**
   * An expression the database computes, never written: spliced into each read, or with `stored` a generated
   * column, `.as(sql`${user.first} || ' ' || ${user.last}`)`. A relation aggregate, `user.resources.count()`,
   * is the other form, read as the subquery a `$count` reads.
   */
  readonly computed?: QuerySql;
  /**
   * Where {@link FieldOptions.computed} lives instead of being spliced into each read. `true` makes it a
   * generated column, which takes only an immutable expression; a list of events makes it a stamp a trigger
   * writes on each, whoever writes the row. It keeps a `currentTimestamp` current; `onUpdate` sees only uql's writes.
   */
  readonly stored?: boolean | readonly StampEvent[];
  readonly updatable?: boolean;
  readonly eager?: boolean;
  readonly onInsert?: OnFieldCallback<V>;
  readonly onUpdate?: OnFieldCallback<V>;
  /**
   * Makes a delete stamp this field instead of removing the row, and reads skip stamped rows. `true`
   * stamps `new Date()`, anything else is the value or callback stamped, `softDelete: () => Date.now()`.
   */
  readonly softDelete?: true | OnFieldCallback<V>;
  /**
   * Makes the column an optimistic lock: an update matches the version its payload carries and writes
   * the next one, so a write against a row someone else moved on throws instead of overwriting it. The
   * column is `NOT NULL DEFAULT 0`, and the entity brands the property with {@link versionKey}.
   */
  readonly version?: true;

  /**
   * The SQL type, where it differs from the one `type` implies: `f.string().columnType('char')`.
   * An engine's own type is a `sql` constant, `.columnType(sql`tsvector`)`, rendered verbatim and
   * never translated, so a column declaring one is yours to keep portable.
   */
  readonly columnType?: ColumnType | QuerySql;
  /** A string column's length. */
  readonly length?: number;
  /** A decimal column's digits, or a timestamp's fractional-second digits. */
  readonly precision?: number;
  /** A decimal column's scale. */
  readonly scale?: number;
  /** Whether the column holds NULL: NOT NULL unless `true`, as `nullable()` writes it. */
  readonly nullable?: true;
  readonly unique?: boolean;
  /** The column's DDL default: a literal, or SQL the database evaluates per inserted row (`currentTimestamp`, `sql`). */
  readonly defaultValue?: DdlDefault<V> | QuerySql;
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

export type OnFieldCallback<V = unknown> = V | QuerySql | (() => V | QuerySql);

/**
 * What a column may default to: its value, or on a JSON column the document it stores, `[]`, or its SQL text,
 * `'{}'`. The erased `FieldOptions` takes them all, so every field's options stay assignable to it.
 */
export type DdlDefault<V, T = NonNullable<V>> =
  IsJsonColumn<T> extends true ? JsonDdlDefault : [TsTypeOf<FieldType>] extends [T] ? JsonDdlDefault | T : T;

/** What a JSON column, and the field-less `FieldOptions`, may default to: a document, a list included, or its text. */
type JsonDdlDefault = Scalar | Record<string, unknown> | readonly unknown[];

/** The TypeScript type a declared `type` implies: a decorator checks the property against it, a schema derives it. */
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
          : T extends StringColumnType | TimeColumnType | DecimalColumnType
            ? string
            : T extends NumericColumnType
              ? number | bigint
              : T extends BooleanColumnType
                ? boolean
                : T extends DateColumnType
                  ? Date
                  : T extends JsonColumnType
                    ? JsonBrand | readonly JsonBrand[]
                    : T extends BlobColumnType
                      ? Uint8Array
                      : T extends VectorColumnType
                        ? readonly number[]
                        : unknown;

/** The entity a relation points at: `Company` for `company?: Company` and `companies?: Company[]` alike. */
export type RelationTarget<V> = Extract<Unpacked<V>, object>;

/** The method names of an entity, which no query reads as a field or a relation. */
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
export type RelationOptions<E, O = unknown> = RelationCascade &
  RelationActions & {
    entity: EntityGetter<E>;
    cardinality: RelationCardinality;
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

/** Whether writes reach the related rows in the same transaction; its own type, so an option set takes it without instantiating `RelationOptions`. */
type RelationCascade = { readonly cascade?: boolean | CascadeType };

/** The foreign key's actions, read on the owning side; unset, the column's own `onDelete` applies. */
type RelationActions = { readonly onDelete?: ForeignKeyAction; readonly onUpdate?: ForeignKeyAction };

/** The one column of `O` that can be a foreign key to `E`: a field holding `E`'s key, which has to be a single one. */
type ForeignKey<O, E> = HasCompositeKey<E> extends true ? never : KeyHolding<O, IdValue<E>>;

/** One pair of join columns, each a field read off its entity's key map, the local one holding the foreign's value. */
export type RelationReference<O, E> = {
  readonly [F in keyof E]-?: { readonly local: KeyHolding<O, E[F]>; readonly foreign: F };
}[FieldKey<E>];

/** The fields of `E` whose value is a `T`, however optional: `FieldKeyOf<E, number | bigint>` are the ones a sum adds up. */
export type FieldKeyOf<E, T> = {
  readonly [K in FieldKey<E>]-?: [NonNullable<E[K]>] extends [T] ? K : never;
}[FieldKey<E>];

/** A value's kind as a join compares it: a number and a bigint are one kind, which BIGINT widens. */
export type JoinKind<T> = T extends number | bigint ? number : T;

/** The fields of `O` that can hold a key of `V`'s kind, compared as a join compares it at run time. */
export type KeyHolding<O, V> = [V] extends [never]
  ? never
  : {
      readonly [K in keyof O]-?: [JoinKind<NonNullable<V>>] extends [JoinKind<NonNullable<O[K]>>] ? K : never;
    }[FieldKey<O>];

/** A relation once `getMeta` resolved it: `references` settled into pairs and `mappedBy` a name. */
export type RelationMeta = Merge<RelationRegistration, { references: RelationReferences }>;

/**
 * A relation as the registry takes it: `mappedBy` and `references` read down to names, `references` a
 * single column until `getMeta` pairs it with the target's key.
 */
export type RelationRegistration = Merge<
  RelationOptions<object>,
  {
    mappedBy?: string;
    references?: RelationReferences | string;
  }
>;

/**
 * What a relation's join callbacks answer, `E` its target and `O` the entity declaring it: one foreign key, pairs of
 * columns, or the target's member mapping it. Each form states its own: a decorated class checks each member's
 * kind, a schema reads keys alone, since its target's types are still being inferred.
 */
export type RelationJoins = { readonly key: unknown; readonly pairs: unknown; readonly mappedBy: unknown };

/** A decorated class's joins, each member checked by kind. */
type DecoratedJoins<E, O> = {
  readonly key: ForeignKey<O, E>;
  readonly pairs: readonly RelationReference<O, E>[];
  readonly mappedBy: RelationKey<E> | ForeignKey<E, O>;
};

/**
 * The side holding the foreign key, which the actions attach to. It cascades `'persist'` only: its target may
 * be other rows' too, so a delete cascades from the side owning the rows.
 */
type RelationOwnerSide = RelationActions & {
  readonly cascade?: 'persist';
  readonly mappedBy?: never;
  readonly through?: never;
};

/** The join columns: a to-one's foreign key, `(post) => post.authorId`, or pairs where no key fits. */
type RelationColumns<E, O, J extends RelationJoins> = (local: KeyMap<O>, foreign: KeyMap<E>) => J['key'] | J['pairs'];

/** The owning side of a to-one, naming its foreign key. */
export type RelationOwnerOptions<E, O, J extends RelationJoins> = RelationOwnerSide & {
  readonly references: RelationColumns<E, O, J>;
};

/** The inverse side, mapped by the target's member holding the foreign key or the owning relation. */
export type RelationInverseOptions<E, J extends RelationJoins> = RelationCascade & {
  readonly mappedBy: (keys: KeyMap<E>) => J['mappedBy'];
  readonly references?: never;
  readonly through?: never;
};

/** How a to-many owner reaches its rows: a junction entity or the join columns, never both. */
export type RelationJoinOptions<E, O, J extends RelationJoins> = RelationCascade & {
  readonly mappedBy?: never;
} & (
    | { readonly through: EntityGetter; readonly references?: never }
    | { readonly references: (local: KeyMap<O>, foreign: KeyMap<E>) => J['pairs']; readonly through?: never }
  );

/** The key names of `E` as values, so a definition reads a member off it, `(post) => post.author`, and follows a rename. */
export type KeyMap<E> = { readonly [K in keyof E]-?: K };

/** The fields of `E` as {@link ColumnRef}s, for SQL that names them: `refs(User)`, or a definition's callback. */
export type RefMap<E, F extends keyof E = FieldKey<E>> = { readonly [K in F]-?: ColumnRef<K & string, E[K]> };

/** One field of `C`, read off its refs: `(item) => item.amount`. */
type PickRef<C, K extends keyof C> = (refs: RefMap<C>) => ColumnRef<K & string>;

/**
 * A relation as a `computed` field reads it, its aggregates typed against the related entity. Each
 * reads as a subquery; all but `count` and `sum` are `null` where the relation holds no row.
 * Declared invariant: measuring `C`'s variance walks every query type it reaches.
 */
export type RelationRef<in out C> = {
  count(q?: AggregatePage<C>): RelationAggregate<number>;
  sum<K extends FieldKeyOf<C, number | bigint>>(
    pick: PickRef<C, K>,
    q?: AggregateRows<C>,
  ): RelationAggregate<NonNullable<C[K]>>;
  min<K extends FieldKey<C>>(pick: PickRef<C, K>, q?: AggregateRows<C>): RelationAggregate<NonNullable<C[K]> | null>;
  max<K extends FieldKey<C>>(pick: PickRef<C, K>, q?: AggregateRows<C>): RelationAggregate<NonNullable<C[K]> | null>;
  avg<K extends FieldKeyOf<C, number | bigint>>(
    pick: PickRef<C, K>,
    q?: AggregateRows<C>,
  ): RelationAggregate<number | null>;
};

/**
 * What an aggregate reads of the related rows: an {@link EntityPredicate} over each row's own fields,
 * so a trigger could keep the aggregate one row at a time without any call site changing.
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

/** Every related row, filtered or not, or the top ones an order picks. */
export type AggregateRows<C> = AggregateFilter<C> | AggregateTopRows<C>;

/** What a `computed` callback reads: the entity's fields as columns, its to-many relations as aggregates. */
export type ComputedRefs<E, F extends keyof E = FieldKey<E>> = RefMap<E, F> & ToManyRefs<E>;

/** Each to-many relation of `E` as an aggregate reads it. */
export type ToManyRefs<E, R extends keyof E = ToManyRelationKey<E>> = {
  readonly [K in R]-?: RelationRef<RelationTarget<E[K]>>;
};

/** A predicate DDL can hold: the entity's own fields, without a relation, `$text` or a sub-query. */
export type EntityPredicate<E> = QueryWhere<E> & { readonly [K in RelationKey<E>]?: never } & {
  readonly $text?: never;
  readonly $exists?: never;
  readonly $nexists?: never;
};

/** A definition's predicate: an {@link EntityPredicate}, or `sql` for what one cannot say. */
export type EntityWhereMeta<E> = EntityPredicate<E> | QuerySql;

export type RelationReferences = { readonly local: string; readonly foreign: string }[];

export type RelationCardinality = '11' | 'm1' | '1m' | 'mm';

export type RelationOneToOneOptions<E, O = unknown> =
  | RelationOwnerOptions<E, O, DecoratedJoins<E, O>>
  | RelationInverseOptions<E, DecoratedJoins<E, O>>;

/** A to-many naming no join: mapped by the one relation of its target pointing back, found on first read. */
type RelationMappedBack<E> = RelationCascade & {
  readonly mappedBy?: never;
  readonly through?: never;
  readonly references?: never;
};

export type RelationOneToManyOptions<E, O = unknown> =
  | RelationInverseOptions<E, DecoratedJoins<E, O>>
  | RelationJoinOptions<E, O, DecoratedJoins<E, O>>
  | RelationMappedBack<E>;

/** A to-one holding the foreign key; with no `references`, it joins by the one field referencing its target. */
export type RelationManyToOneOptions<E, O = unknown> = RelationOwnerSide &
  Partial<Pick<RelationOwnerOptions<E, O, DecoratedJoins<E, O>>, 'references'>>;

export type RelationManyToManyOptions<E, O = unknown> =
  | RelationJoinOptions<E, O, DecoratedJoins<E, O>>
  | RelationInverseOptions<E, DecoratedJoins<E, O>>;

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

/** A hook as declared: the entity's method a decorator names, or the function a schema runs on the row. */
export type HookDeclaration = { readonly methodName: string } | { readonly run: HookFunction };

/** A registered hook, run on the row; a method's name kept so an entity overriding it replaces its base's. */
export type HookRegistration = { readonly run: HookFunction; readonly methodName?: string };

/**
 * What a lifecycle hook is handed: the querier, to write in the same transaction, and `onCommit`, for what
 * must wait until that transaction commits.
 */
export type HookContext = {
  readonly querier: Querier;
  readonly onCommit: Querier['onCommit'];
};

/** A schema entity's hook, bivariant in its row, so one typed by its row registers. */
export type HookFunction = { run(row: object, ctx: HookContext): unknown }['run'];

/**
 * An index type with what it needs: a vector index has to name its metric, since engines default to a
 * different one than the queries use; an Atlas `vectorSearch` index may, else takes its field's, else
 * cosine; a `fulltext` one may name the text-search `config` it parses with; and any other index neither.
 */
export type IndexTypeOptions =
  | { readonly type: VectorIndexType; readonly distance: VectorDistance; readonly config?: never }
  | { readonly type: 'vectorSearch'; readonly distance?: VectorDistance; readonly config?: never }
  | { readonly type: 'fulltext'; readonly distance?: never; readonly config?: string }
  | {
      readonly type?: Exclude<IndexType, VectorIndexType | 'vectorSearch' | 'fulltext'>;
      readonly distance?: never;
      readonly config?: never;
    };

/** What an index entry carries besides what it indexes, at every layer. */
export type IndexEntryModifiers = {
  /** Stored sort order, which lets `ORDER BY ... DESC` pagination use the index. */
  readonly order?: 'asc' | 'desc';
  /** Where NULLs sort. Postgres only. */
  readonly nulls?: 'first' | 'last';
  /** Operator class, e.g. `jsonb_path_ops` for a smaller GIN index. Postgres only. */
  readonly opsClass?: string;
  /**
   * How many times a match in this column of a fulltext index counts in `$sort: { $text }`, 1 by default:
   * a whole number from 1 to 99999, the range MongoDB weighs by.
   */
  readonly weight?: number;
};

/** How an index reads a JSON path: the type its queries compare it as, or `[type]` for each element of an array. */
export type IndexValueType = FieldType | readonly [FieldType];

/**
 * One index entry: a column as stored, a `path` inside the JSON column `json` read as `type` (text by default,
 * the whole document where it names no path), or an expression. `Sql` is the expression's form, `QuerySql`
 * until the schema renders it to text.
 */
export type IndexEntry<Sql = QuerySql> = IndexEntryModifiers &
  (
    | (ColumnLengths & {
        readonly column: string;
        readonly json?: never;
        readonly path?: never;
        readonly type?: never;
        readonly expression?: never;
      })
    | (JsonLengths & {
        readonly json: string;
        readonly path?: string;
        readonly type?: IndexValueType;
        readonly column?: never;
        readonly expression?: never;
      })
    | (NoLengths & {
        readonly expression: Sql;
        readonly column?: never;
        readonly json?: never;
        readonly path?: never;
        readonly type?: never;
      })
  );

/** The key length a column entry takes. */
type ColumnLengths = {
  /** A prefix of the column as the key, which the MySQL family requires on a `TEXT` or `BLOB` one. */
  readonly prefixLength?: number;
  readonly charLength?: never;
};

/** An entry keyed by its value whole: an expression, or a JSON number or boolean. */
type NoLengths = { readonly prefixLength?: never; readonly charLength?: never };

/** The key length a JSON path entry takes. */
type JsonLengths = {
  /** The `CHAR(n)` MySQL keys a string path, or each string element, as. */
  readonly charLength?: number;
  readonly prefixLength?: never;
};

/** One index entry as the migration builder takes it: a column name, `sql`, or an entry when it needs more. */
export type IndexColumnInput = string | QuerySql | IndexEntry;

declare const untypedJson: unique symbol;

/** The value under a path of a bare {@link Json} column, which any path reads into, as text unless told otherwise. */
type UntypedJson = { readonly [untypedJson]: true };

/** Any path into an untyped payload, to any depth. */
interface UntypedJsonPaths {
  readonly [key: string]: JsonPathRef<UntypedJson> & UntypedJsonPaths;
}

/** The paths below one holding `V`: each key of an object, any key of an untyped payload, none past a value. */
type JsonPathMembers<V> = unknown extends V
  ? UntypedJsonPaths
  : V extends readonly unknown[]
    ? unknown
    : V extends object
      ? {
          readonly [K in Exclude<keyof V, RefOwnKey>]-?: JsonPathRef<NonNullable<V[K]>> &
            JsonPathMembers<NonNullable<V[K]>>;
        }
      : unknown;

/** The keys a path cannot be read through: a ref's own, and `Object`'s, which every ref has. */
type RefOwnKey = Extract<keyof ColumnRef, string> | keyof typeof Object.prototype;

/** A field as an index reads it: its column, and a JSON one's paths too. */
type IndexRef<K extends string, V> =
  IsJsonColumn<V> extends true
    ? ColumnRef<K, V> & JsonPathRef<UntypedLeaf<JsonPayload<V>>> & JsonPathMembers<JsonPayload<V>>
    : ColumnRef<K, V>;

type UntypedLeaf<P> = unknown extends P ? UntypedJson : P;

/** An index's refs: the entity's fields, each JSON one read into along its document's paths. */
export type IndexRefMap<E, F extends keyof E = FieldKey<E>> = { readonly [K in F]-?: IndexRef<K & string, E[K]> };

/** The types a JSON value of `V` can be compared as, which an index on it reads it as. */
type JsonReadAs<V> = V extends string
  ? StringConstructor | StringColumnType
  : V extends number
    ? NumberConstructor | NumericColumnType
    : V extends boolean
      ? BooleanConstructor | BooleanColumnType
      : never;

/**
 * What an object entry indexes: a column or `sql` as it is, or a JSON path read as its queries compare it.
 * A path holding text may say nothing; any other states its `type`, `[type]` for an array's elements.
 */
type IndexEntryTarget =
  | (ColumnLengths & { readonly column: QuerySql; readonly type?: never })
  | (JsonLengths & { readonly column: JsonPathRef<string>; readonly type?: JsonReadAs<string> })
  | (NoLengths & { readonly column: JsonPathRef<number>; readonly type: JsonReadAs<number> })
  | (NoLengths & { readonly column: JsonPathRef<boolean>; readonly type: JsonReadAs<boolean> })
  | (JsonLengths & { readonly column: JsonPathRef<readonly string[]>; readonly type: readonly [JsonReadAs<string>] })
  | (NoLengths & { readonly column: JsonPathRef<readonly number[]>; readonly type: readonly [JsonReadAs<number>] })
  | (JsonLengths & { readonly column: JsonPathRef<UntypedJson>; readonly type?: IndexValueType });

/**
 * One entry of an entity's index, read off its refs: a column, a path inside a JSON one, `sql`, or an object
 * when it needs more.
 * @example `{ columns: (post) => [post.tenantId, { column: post.createdAt, order: 'desc' }, sql`lower(${post.email})`] }`
 * @example `{ columns: (user) => [user.settings.theme, { column: user.settings.rating, type: Number }] }`
 */
export type EntityIndexColumnInput =
  | QuerySql
  | JsonPathRef<string>
  | JsonPathRef<UntypedJson>
  | (IndexEntryModifiers & IndexEntryTarget);

/**
 * What an index states the same at every layer. Each layer adds its own `include` and `where` beside it, so nothing
 * maps over `IndexTypeOptions`' arms: `type` and `distance` stay a discriminated pair at no instantiation cost.
 */
export type IndexKnobs = {
  /** Custom index name */
  readonly name?: string;
  /** Whether index is unique; omit or `false` for a non-unique index (default). */
  readonly unique?: boolean;
} & VectorIndexOptions &
  IndexTypeOptions;

/** An index as metadata keeps it. */
export type EntityIndexMeta<E = object> = {
  /** The indexed entries, in order. */
  readonly entries: readonly IndexEntry[];
  /** Columns stored in the index beyond its key, so a query reading only these needs no row. Postgres-wire only. */
  readonly include?: readonly string[];
  /** Partial index predicate, compiled when the schema is built. */
  readonly where?: EntityWhereMeta<E>;
} & IndexKnobs;

export type EntityMeta<E> = {
  readonly entity: AbstractType<E>;
  /** The table, which is the class's own name where the entity named none - see {@link derivedName}. */
  name?: string;
  /** Whether {@link name} came from the class rather than from the author, so a naming strategy applies. */
  derivedName?: boolean;
  /** A base that is never a table, only extended. */
  abstract?: true;
  /** Set only when the entity named one; unset defers to the pool where it is used. See `AbstractDialect.resolveSchema`. */
  schema?: string;
  /** Every column of the primary key, in declaration order. */
  ids: readonly IdKey<E>[];
  softDelete?: FieldKey<E>;
  /** The optimistic lock's column, from `f.version()`. */
  version?: FieldKey<E>;
  /** Named, default-on `$where` filters applied to every query unless bypassed. */
  filters?: Record<string, FilterOptions<E>>;
  fields: {
    [K in FieldKey<E>]?: FieldMeta;
  } & { [key: string]: FieldMeta | undefined };
  relations: {
    [K in RelationKey<E>]?: RelationMeta;
  } & { [key: string]: RelationMeta | undefined };
  /** The indexes `@Entity({ indexes })` or a schema's `indexes` declare. */
  indexes?: EntityIndexMeta<E>[];
  /** `CHECK` constraints, compiled when the schema is built. */
  checks?: EntityCheckMeta<E>[];
  /** Lifecycle hooks registered via @BeforeInsert, @AfterUpdate, etc. */
  hooks?: Partial<Record<HookEvent, HookRegistration[]>>;
  /** Triggers the database runs, compiled when the schema is built. */
  triggers?: EntityTriggerMeta<E>[];
  /**
   * How far the registry finalized it: `'declared'` while a schema takes sections and is not registered, unset
   * once registered, `'settled'` once its schemas' relations, its bases' included, are in, and `'resolved'`
   * once `getMeta` joined them too, which makes each step idempotent and re-entrant.
   */
  stage?: 'declared' | 'settled' | 'resolved';
  /** The fields a read answers with where it names none, set once resolved: see `defaultReadKeys`. */
  readKeys?: readonly FieldKey<E>[];
  /** The fields holding another entity's key, set once resolved: see `referenceKeys`. */
  referenceKeys?: ReadonlySet<string>;
};

/** When the database writes a stamp: as the row is inserted, as it is updated, or both. */
export type StampEvent = 'insert' | 'update';

/**
 * The events a trigger fires on: the lifecycle names, minus the upsert pair, which names no event of its
 * own because `ON CONFLICT` fires the insert or the update triggers, and minus `afterLoad`, which is a
 * read. Derived from {@link HookEvent} so the two vocabularies cannot drift.
 */
export type TriggerEvent = Exclude<HookEvent, 'beforeUpsert' | 'afterUpsert' | 'afterLoad'>;

/** Both events for one operation, since a trigger's timing never changes which rows it has. */
type TriggerEventOn<Op extends string> = Extract<TriggerEvent, `before${Op}` | `after${Op}`>;

/** The events with a row on both sides, the only ones that can say which columns moved. */
type TriggerUpdateEvent = TriggerEventOn<'Update'>;

/**
 * The rows an event has, as `where` keys them: the incoming one on an insert, the outgoing one on a
 * delete, both on an update.
 */
type TriggerRow<Ev extends TriggerEvent> =
  Ev extends TriggerEventOn<'Insert'> ? '$new' : Ev extends TriggerEventOn<'Delete'> ? '$old' : '$new' | '$old';

/** One row's refs, rendering `NEW."col"` or `OLD."col"`, or `never` where the event has no such row. */
type TriggerRowRefs<E, Ev extends TriggerEvent, R extends '$new' | '$old'> =
  R extends TriggerRow<Ev> ? RefMap<E> : never;

/**
 * What a trigger runs, over its rows: the incoming row first and the outgoing one second, on every event.
 * The one an event lacks is `never`, so reading it does not compile, and a body reading only the outgoing
 * row - `(_newRow, oldRow)` - serves an update and a delete alike.
 */
type TriggerBody<E, Ev extends TriggerEvent> = (
  newRow: TriggerRowRefs<E, Ev, '$new'>,
  oldRow: TriggerRowRefs<E, Ev, '$old'>,
) => QuerySql;

/**
 * A condition as data: a predicate on each row it names, of the rows the event has, all of which hold.
 * The row is `$`-marked, as the operators inside it are, so it never reads as a field of the entity.
 */
type TriggerPredicate<E, Ev extends TriggerEvent> = {
  readonly [R in TriggerRow<Ev>]?: EntityPredicate<E>;
};

/**
 * The body, the engine's own SQL: one for every engine it reads alike, or a map naming one per engine
 * where they differ, as SQL Server's set-based `inserted`/`deleted` does. A missing entry for the engine
 * in use is refused at `sync`, since an entity is declared without knowing which pool will render it.
 */
type TriggerRun<E, Ev extends TriggerEvent> =
  | TriggerBody<E, Ev>
  | Readonly<AtLeastOne<Record<SqlDialectName, TriggerBody<E, Ev>>>>;

/**
 * A trigger, `{ on: 'beforeUpdate', of: (post) => [post.body], run: (newRow) => sql`...` }`.
 *
 * A list rather than a map keyed by the event, as `checks` and `indexes` are lists: several triggers may
 * share an event, they fire in the order written, and each is named, diffed and dropped by that name.
 */
export type TriggerOptions<E = unknown> = {
  [Ev in TriggerEvent]: {
    /**
     * The write that fires the trigger and on which side of it, `beforeUpdate` or `afterDelete`. The rows
     * the body has follow from it: the incoming one on an insert, the outgoing one on a delete, both on an
     * update.
     */
    readonly on: Ev;
    /**
     * What to call this trigger within the entity, for a clearer identifier than its event and position.
     * A label, not the identifier: uql prefixes and qualifies what it installs, so it can tell its own
     * objects from hand-written ones and two entities may share a label.
     */
    readonly name?: string;
    /**
     * The columns whose change the trigger waits for, reading as the `UPDATE OF` it renders. Beside it
     * goes a `WHEN` comparing each with `IS DISTINCT FROM`, which is the point of the pair: `UPDATE OF`
     * fires on a column that was merely assigned, and the comparison narrows that to one that moved.
     */
    readonly of?: Ev extends TriggerUpdateEvent ? readonly ColumnRef<FieldKey<E>>[] : never;
    /**
     * A further condition, as the `WHEN` the engine evaluates before entering the body, over the rows the
     * body reads: a predicate on each, `{ $old: { status: 'draft' }, $new: { status: 'published' } }`,
     * rendered on every engine from the one declaration, or SQL off them for what no predicate states.
     */
    readonly where?: TriggerPredicate<E, Ev> | TriggerBody<E, Ev>;
    /**
     * Fire at commit rather than after each statement, so a check over many rows (a ledger's entries
     * summing to zero) sees the transaction's every write. Postgres only, and only after the write.
     */
    readonly deferred?: Ev extends `after${string}` ? boolean : never;
    /**
     * The body, as SQL off the rows, `(newRow, oldRow) => sql`...``: the incoming row first and the
     * outgoing one second, the one `on` lacks typed `never`. One for every engine, or a map naming one
     * per engine where their SQL differs.
     */
    readonly run: TriggerRun<E, Ev>;
  };
}[TriggerEvent];

/**
 * A trigger as entity metadata keeps it: the column callback resolved to keys, and a body widened to
 * take both rows, which the renderer passes whatever the event, each body reading only its own.
 */
export type EntityTriggerMeta<E = object> = Merge<
  TriggerOptions<E>,
  {
    readonly of?: readonly string[];
    readonly where?: TriggerPredicate<E, TriggerUpdateEvent> | TriggerMetaBody<E>;
    readonly run: TriggerMetaBody<E> | Readonly<Partial<Record<SqlDialectName, TriggerMetaBody<E>>>>;
  }
>;

/**
 * A body as the renderer calls it, with both rows whatever the event. Bivariant,
 * so a body typing the row its event lacks as `never` is still held here.
 */
export type TriggerMetaBody<E> = { run(newRow: RefMap<E>, oldRow: RefMap<E>): QuerySql }['run'];

/** A table's `CHECK`: a predicate, `{ balance: { $gte: 0 } }`, or SQL off the refs, `sql`${wallet.spent} >= 0``. */
export type CheckOptions<E = unknown> = {
  /** Derived from the table and the constraint's position when absent. */
  readonly name?: string;
  readonly where: EntityPredicate<E> | QuerySql;
};

/**
 * Marks what a section's helper returned, so a section takes only what TypeScript checked: it checks a literal
 * passed to a function, and never one a callback returns, where `{ uniqe: true }` would pass silently.
 */
export const SECTION_ENTRY: unique symbol = Symbol('sectionEntry');

/** One entry of a section, as its helper made it. */
export type SectionEntry<T, S extends string> = T & { readonly [SECTION_ENTRY]: S };

/**
 * An entity's indexes over its refs, the columns first and the options or the name after, as the migration
 * builder's `index()` takes them: `(post, index) => [index([post.slug], { unique: true })]`.
 */
export type IndexSection<E> = (
  refs: IndexRefMap<E>,
  index: (
    columns: readonly EntityIndexColumnInput[],
    options?: string | EntityIndexOptions<E>,
  ) => SectionEntry<EntityIndexInput<E>, 'index'>,
) => readonly SectionEntry<EntityIndexInput<E>, 'index'>[];

/** An entity's `CHECK`s over its refs, `(wallet, check) => [check(sql`${wallet.spent} >= 0`)]`, a name after. */
export type CheckSection<E> = (
  refs: RefMap<E>,
  check: (where: CheckOptions<E>['where'], name?: string) => SectionEntry<CheckOptions<E>, 'check'>,
) => readonly SectionEntry<CheckOptions<E>, 'check'>[];

/** An entity's triggers over its refs, `(post, trigger) => [trigger({ on: 'beforeUpdate', of: [post.body], run })]`. */
export type TriggerSection<E> = (
  refs: RefMap<E>,
  trigger: (trigger: TriggerOptions<E>) => SectionEntry<TriggerOptions<E>, 'trigger'>,
) => readonly SectionEntry<TriggerOptions<E>, 'trigger'>[];

/** An entity's named, default-on `$where` filters; a `softDelete()` column registers its own. */
export type FilterSection<E> = Readonly<Record<string, FilterOptions<E>>> & { readonly [SOFT_DELETE_FILTER]?: never };

/** A `CHECK` as entity metadata keeps it, its callback resolved. */
export type EntityCheckMeta<E = object> = {
  readonly name?: string;
  readonly where: EntityWhereMeta<E>;
};

/** A decorated entity's options, `@Entity()`. */
export type EntityOptions<E = unknown> = {
  readonly name?: string;
  /** A base that is never a table: the entities extending it take what it declares. */
  readonly abstract?: true;
  /** The schema (a MySQL database) the table lives in; unset follows the pool's. */
  readonly schema?: string;
  readonly filters?: FilterSection<E>;
  readonly indexes?: IndexSection<E>;
  /** Table-level `CHECK` constraints. See {@link CheckOptions}. */
  readonly checks?: CheckSection<E>;
  /** Triggers the database runs, in the order written. See {@link TriggerOptions}. */
  readonly triggers?: TriggerSection<E>;
};

/** Everything an index carries beyond its columns, as the migration builder's `table.index(...)` takes it. */
export type IndexOptions = IndexKnobs & {
  /** Columns stored in the index beyond its key, so a query reading only these needs no row. Postgres-wire only. */
  readonly include?: readonly string[];
  /** Partial-index predicate, as `sql` with no interpolation: the migration builder has no entity to compile one against. */
  readonly where?: QuerySql;
};

/** {@link IndexOptions} on an entity, `include` and `where` read off the section's refs as its columns are. */
export type EntityIndexOptions<E> = IndexKnobs & {
  readonly include?: readonly ColumnRef<FieldKey<E>>[];
  /**
   * Partial-index predicate, written as the predicate the query passes: a planner matches the two by
   * shape, so a hand-written `sql` that means the same thing leaves the index unused.
   */
  readonly where?: EntityPredicate<E> | QuerySql;
};

/** An index as registration reads it: its columns, read off the refs, and its options. */
export type EntityIndexInput<E> = EntityIndexOptions<E> & { readonly columns: readonly EntityIndexColumnInput[] };
