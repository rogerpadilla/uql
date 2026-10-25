import type { ForeignKeyAction } from '../schema/types.js';
import type { Column, ColumnOptionsOf, ColumnValueOf, FilledOptions, NullOf } from './column.js';
import type {
  CheckSection,
  FilterSection,
  filledKey,
  HookContext,
  HookEvent,
  idKey,
  IdValue,
  IndexSection,
  IsUnion,
  RefMap,
  RelationCardinality,
  RelationInverseOptions,
  RelationJoinOptions,
  RelationOwnerOptions,
  RelationRef,
  ToManyRefs,
  ToManyRelationKey,
  TriggerSection,
  versionKey,
} from './entity.js';
import type { QuerySql, RelationAggregate } from './querySql.js';
import type { Type } from './utility.js';

/**
 * A schema entity's columns, each an `f` builder. A foreign key is declared in `.references()`, once every entity
 * exists: one written here would read its target while that target's own type is still being inferred. A computed
 * column is declared in `.computed()`, where its row is read-only.
 */
export type SchemaFields = {
  readonly [key: string]: Column<
    { readonly references?: undefined; readonly computed?: undefined } & { readonly [key: string]: unknown }
  >;
};

/** The key a class holds: carried beside a schema's, so a cycle never reads its row; read off a decorated one's. */
export type ReferencedKey<C> = C extends { readonly [schemaShape]?: { readonly key: infer K } }
  ? unknown extends K
    ? RowKey<C>
    : K
  : RowKey<C>;

type RowKey<C> = C extends Type<infer R> ? NonNullable<IdValue<R>> : never;

/** The keys of `F` whose column is a `C`. */
type FlagKeys<F, C> = { [K in keyof F]-?: F[K] extends C ? K : never }[keyof F];

/**
 * The columns as a row reads them, mapped over parameters constrained to `keyof F` so each key stays linked to
 * its declaration for a rename. A nullable column may be absent on insert and reads `null`.
 */
export type ColumnRow<
  F,
  Nullable extends keyof F = FlagKeys<F, Column<{ readonly nullable: true }>>,
  Present extends keyof F = Exclude<keyof F, Nullable>,
> = { -readonly [K in Present]-?: ColumnValueOf<F[K]> } & { -readonly [K in Nullable]?: ColumnValueOf<F[K]> | null };

/** The computed columns as a row reads them, never written. */
type ComputedRow<C> = {
  readonly [K in keyof C]?: ColumnValueOf<C[K]> | NullOf<ColumnOptionsOf<C[K]>>;
};

/** What `.computed()` returns: columns the database computes, `f.string().as(sql`...`)`. */
type SchemaComputed = { readonly [key: string]: Column<{ readonly computed: QuerySql }> };

/** A relation as a schema declares it: what `rel.*` returns, its target carried for the row. */
export type SchemaRelation<T = object, C extends RelationCardinality = RelationCardinality, Columns = T> = {
  readonly target: Type<T>;
  readonly cardinality: C;
  /** Checked by the builder's signature, so held erased: the registry reads them back as any relation's options. */
  readonly options?: object;
  /** The target's columns, which an aggregate over the relation reads. */
  readonly columns?: Columns;
};

/** Each to-many relation as an aggregate reads it, typed by its target's columns, read lazily as the relations are. */
type AggregateRefs<R> = {
  readonly [K in keyof R]: R[K] extends () => { readonly cardinality: '1m' | 'mm'; readonly columns?: infer Columns }
    ? RelationRef<Columns>
    : never;
};

/** The aggregates as a row reads them, each a computed column typed by the value it reads, never written. */
export type AggregateRow<A> = {
  readonly [K in keyof A]?: A[K] extends () => RelationAggregate<infer V> ? V : never;
};

type RelationValue<P> = P extends () => SchemaRelation<infer T, infer C, unknown>
  ? C extends '1m' | 'mm'
    ? T[]
    : T
  : never;

/** The relations as a row reads them; exported, as a schema's emitted declaration names it. */
export type RelationRow<R> = { -readonly [K in keyof R]?: RelationValue<R[K]> };

/** The brands the type level reads keys off, derived from the columns rather than written by hand. */
export type Brands<F> = {
  readonly [idKey]?: FlagKeys<F, Column<{ readonly isId: true }>>;
  readonly [versionKey]?: FlagKeys<F, Column<{ readonly version: true }>>;
  readonly [filledKey]?: Exclude<FlagKeys<F, Column<FilledOptions>>, FlagKeys<F, Column<{ readonly isId: true }>>>;
};

/** The relation constructors a schema's `relations` receives, typed by the columns of the entity declaring them. */
export type RelationBuilder<O> = {
  oneToOne<T extends object, K = IdValue<T>, Columns = T>(
    target: Type<T> & SchemaShape<K, Columns>,
    opts:
      | RelationOwnerOptions<T, O, SchemaJoins<T, O, K, Columns>>
      | RelationInverseOptions<T, SchemaJoins<T, O, K, Columns>>,
  ): SchemaRelation<T, '11'>;
  manyToOne<T extends object, K = IdValue<T>, Columns = T>(
    target: Type<T> & SchemaShape<K, Columns>,
    opts: RelationOwnerOptions<T, O, SchemaJoins<T, O, K, Columns>>,
  ): SchemaRelation<T, 'm1'>;
  /** With no options, it is mapped by the one many-to-one of its target pointing back. */
  oneToMany<T extends object, Columns = T>(
    target: Type<T> & SchemaShape<unknown, Columns>,
    opts?:
      | RelationInverseOptions<T, SchemaJoins<T, O, unknown, Columns>>
      | RelationJoinOptions<T, O, SchemaJoins<T, O, unknown, Columns>>,
  ): SchemaRelation<T, '1m', Columns>;
  manyToMany<T extends object, Columns = T>(
    target: Type<T> & SchemaShape<unknown, Columns>,
    opts:
      | RelationInverseOptions<T, SchemaJoins<T, O, unknown, Columns>>
      | RelationJoinOptions<T, O, SchemaJoins<T, O, unknown, Columns>>,
  ): SchemaRelation<T, 'mm', Columns>;
};

/**
 * A schema's joins: a foreign key and paired columns checked by type, off the target's carried key and columns;
 * `mappedBy` by key alone, its kind checked on first read.
 */
type SchemaJoins<T, O, K = unknown, Columns = T> = {
  readonly key: KeyHolding<O, K>;
  readonly pairs: readonly SchemaJoinPair<O, Columns>[];
  readonly mappedBy: keyof T;
};

/** One pair of join columns, the local one holding what the target's column does. */
type SchemaJoinPair<O, Columns> = {
  readonly [F in keyof Columns]-?: { readonly local: KeyHolding<O, NonNullable<Columns[F]>>; readonly foreign: F };
}[keyof Columns];

/** What the first call of a schema states: the class, its table and its columns. */
export type SchemaEntityOptions<F extends SchemaFields, B = object, BK = unknown, BC = unknown> = {
  /** The class's name, which a naming strategy derives the table's from, as it does a decorated class's. */
  readonly name: string;
  /** The table, exactly as the database names it, where it is not derived from `name`. */
  readonly table?: string;
  /** The schema (a MySQL database) the table lives in; unset follows the pool's. */
  readonly schema?: string;
  /** A base that is never a table: the entities extending it take what it declares. */
  readonly abstract?: true;
  /** The entity it inherits from, which the declared class extends, so its methods and `super` work. */
  readonly extends?: SchemaClass<B, BK, BC>;
  readonly fields: F;
};

/** A hook a schema runs on a row; a promise it returns is awaited. */
type SchemaHook<Row> = (row: Row, ctx: HookContext) => unknown;

/**
 * Each foreign key column's target, `{ authorId: () => Author }`, or with its delete action. The getter is typed as
 * returning nothing: typing its target would read an entity referencing itself while it is inferred, so the key's
 * kind is checked on first read.
 */
type SchemaReferences<Columns> = {
  readonly [K in keyof Columns]?: LazyTarget | { readonly entity: LazyTarget; readonly onDelete?: ForeignKeyAction };
};

/** The entity a foreign key points at, read once every entity exists. */
type LazyTarget = () => void;

/**
 * What a schema declares after its columns, each section typed by the columns now fixed, so none is inferred
 * again. `relations` comes last: what follows a relation would read its target while that target is inferred.
 */
type SchemaSections<Row, Key, Columns, B> = {
  /** Columns the database computes off the stored ones, `(post) => ({ slug: f.string().as(sql`...`) })`. */
  computed<const C extends SchemaComputed>(
    computed: (refs: RefMap<Columns>) => C,
  ): SchemaEntity<Row & ComputedRow<C>, Key, Columns & ComputedRow<C>, B>;
  indexes(indexes: IndexSection<Columns>): SchemaEntity<Row, Key, Columns, B>;
  checks(checks: CheckSection<Columns>): SchemaEntity<Row, Key, Columns, B>;
  triggers(triggers: TriggerSection<Columns>): SchemaEntity<Row, Key, Columns, B>;
  filters(filters: FilterSection<Row>): SchemaEntity<Row, Key, Columns, B>;
  /** Functions each lifecycle event runs on the row, in order, given the querier writing it. */
  hooks(hooks: { readonly [E in HookEvent]?: readonly SchemaHook<Row>[] }): SchemaEntity<Row, Key, Columns, B>;
  /** The foreign keys no relation joins on, each column's target: `{ authorId: () => Author }`. */
  references(references: SchemaReferences<Columns>): SchemaEntity<Row, Key, Columns, B>;
  /**
   * The relations, each read lazily so entities pointing at each other declare in either order, and the values
   * read over the to-many ones, its base's too: `(agg) => ({ postCount: () => agg.posts.count() })`.
   */
  relations<const R, const A = {}>(
    relations: (rel: RelationBuilder<Columns>) => R,
    aggregates?: (agg: AggregateRefs<R> & ToManyRefs<B, Exclude<ToManyRelationKey<B>, keyof R>>) => A,
  ): SchemaClass<Row & RelationRow<R> & AggregateRow<A>, Key, Columns>;
};

/** A schema entity's class while its sections may still be declared. */
export type SchemaEntity<Row, Key, Columns, B> = SchemaClass<Row, Key, Columns> & SchemaSections<Row, Key, Columns, B>;

/** The class a schema declares, to use as it is or to extend with behaviour. */
export type SchemaClass<Row, Key = unknown, Columns = unknown> = (new () => Row) & SchemaShape<Key, Columns>;

declare const schemaShape: unique symbol;

/**
 * What a relation or an aggregate pointing at a schema reads of it, its key's type and its columns, carried beside
 * its class rather than read off its row: the columns alone settle both while the row is still being inferred.
 */
type SchemaShape<Key, Columns = unknown> = {
  readonly [schemaShape]?: { readonly key: Key; readonly columns: Columns };
};

/**
 * The key's type: its own column's, else the base's it inherits, `never` for a composite, which no one column can
 * reference, and anything for a schema built from data, whose columns are known only at run time.
 */
export type SchemaKey<F, Inherited = unknown> = string extends keyof F
  ? unknown
  : FlagKeys<F, Column<{ readonly isId: true }>> extends infer K extends keyof F
    ? [K] extends [never]
      ? Inherited
      : true extends IsUnion<K>
        ? never
        : ColumnValueOf<F[K]>
    : never;

/** The columns of `O` holding a `V`: a foreign key to a key of that type. */
type KeyHolding<O, V> = { [K in keyof O]-?: NonNullable<O[K]> extends V ? K : never }[keyof O];
