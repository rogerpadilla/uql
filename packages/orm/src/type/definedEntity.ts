import type { Column, ColumnOptionsOf, ColumnValueOf, FilledOptions, NullOf } from './column.js';
import type {
  BrandNames,
  CheckSection,
  FilterSection,
  filledKey,
  HookContext,
  HookEvent,
  idKey,
  IdValue,
  IndexSection,
  IsUnion,
  KeyHolding,
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
import type { Type, AbstractType } from './utility.js';

/**
 * A defined entity's columns, each an `f` builder. A foreign key's target is a relation in `.relations()`, read lazily:
 * a column naming its target here would read it while it is still being inferred. A computed column is declared in
 * `.computed()`, where its row is read-only.
 */
export type DefinedFields = {
  readonly [key: string]: Column<
    { readonly references?: undefined; readonly computed?: undefined } & { readonly [key: string]: unknown }
  >;
};

/** The key a class holds: carried beside a defined one's, so a cycle never reads its row; read off a decorated one's. */
export type ReferencedKey<C> = C extends { readonly [definedShape]?: { readonly key: infer K } }
  ? unknown extends K
    ? RowKey<C>
    : K
  : RowKey<C>;

type RowKey<C> = C extends AbstractType<infer R> ? NonNullable<IdValue<R>> : never;

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

/** A map of fields as a row reads them, never written: required, except an `eager(false)` column, which may be absent. */
type ReadRow<M> = {
  readonly [K in keyof M as IsEager<M[K]> extends true ? K : never]-?: FieldValue<M[K]>;
} & {
  readonly [K in keyof M as IsEager<M[K]> extends true ? never : K]?: FieldValue<M[K]>;
};

type FieldValue<F> = F extends RelationAggregate<infer V> ? V : ColumnValueOf<F> | NullOf<ColumnOptionsOf<F>>;

type IsEager<F> =
  F extends RelationAggregate<unknown> ? true : ColumnOptionsOf<F> extends { readonly eager: false } ? false : true;

/** What `.computed()` returns: columns the database computes, `f.string().as(sql`...`)`. */
type DefinedComputed = { readonly [key: string]: Column<{ readonly computed: QuerySql }> };

/** A relation as a defined entity declares it: what `rel.*` returns, its target carried for the row. */
export type DefinedRelation<T = object, C extends RelationCardinality = RelationCardinality, Columns = T> = {
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

type RelationValue<P> = P extends () => DefinedRelation<infer T, infer C, unknown>
  ? C extends '1m' | 'mm'
    ? T[]
    : T
  : never;

/** A relation's derived field as its callback declares it: a thunk, so it is read lazily like a relation is. */
export type DerivedFields = {
  readonly [key: string]: () => RelationAggregate<unknown> | Column<{ readonly computed: QuerySql }>;
};

/** The derived fields a `relations` callback declares, as a row reads them, never written. */
export type DerivedRow<A> = {
  readonly [K in keyof A]-?: A[K] extends () => infer F ? FieldValue<F> : never;
};

/** The relations as a row reads them; exported, as a defined entity's emitted declaration names it. */
export type RelationRow<R> = { -readonly [K in keyof R]?: RelationValue<R[K]> };

/**
 * The brands the type level reads keys off, derived from the columns rather than written by hand. A subtype's
 * brands add to its base's, since an intersection with them would narrow each to what the subtype declares.
 */
export type Brands<F, B = object> = {
  readonly [idKey]?: IdKeyOf<F> | BrandNames<B, typeof idKey>;
  readonly [versionKey]?: VersionKeyOf<F> | BrandNames<B, typeof versionKey>;
  readonly [filledKey]?: FilledKeyOf<F> | BrandNames<B, typeof filledKey>;
};

/** The keys of `F` a brand marks, read off its columns: the id, the version, and the fields a default fills. */
type IdKeyOf<F> = FlagKeys<F, Column<{ readonly isId: true }>>;
type VersionKeyOf<F> = FlagKeys<F, Column<{ readonly version: true }>>;
type FilledKeyOf<F> = Exclude<FlagKeys<F, Column<FilledOptions>>, IdKeyOf<F>>;

/** The relation constructors a defined entity's `relations` receives, typed by the columns of the entity declaring them. */
export type RelationBuilder<O> = {
  oneToOne<T extends object, K = IdValue<T>, Columns = T>(
    target: Type<T> & DefinedShape<K, Columns>,
    opts:
      | RelationOwnerOptions<T, O, DefinedJoins<T, O, K, Columns>>
      | RelationInverseOptions<T, DefinedJoins<T, O, K, Columns>>,
  ): DefinedRelation<T, '11'>;
  manyToOne<T extends object, K = IdValue<T>, Columns = T>(
    target: Type<T> & DefinedShape<K, Columns>,
    opts: RelationOwnerOptions<T, O, DefinedJoins<T, O, K, Columns>>,
  ): DefinedRelation<T, 'm1'>;
  /** With no options, it is mapped by the one many-to-one of its target pointing back. */
  oneToMany<T extends object, Columns = T>(
    target: Type<T> & DefinedShape<unknown, Columns>,
    opts?:
      | RelationInverseOptions<T, DefinedJoins<T, O, unknown, Columns>>
      | RelationJoinOptions<T, O, DefinedJoins<T, O, unknown, Columns>>,
  ): DefinedRelation<T, '1m', Columns>;
  manyToMany<T extends object, Columns = T>(
    target: Type<T> & DefinedShape<unknown, Columns>,
    opts:
      | RelationInverseOptions<T, DefinedJoins<T, O, unknown, Columns>>
      | RelationJoinOptions<T, O, DefinedJoins<T, O, unknown, Columns>>,
  ): DefinedRelation<T, 'mm', Columns>;
};

/**
 * A defined entity's joins: a foreign key and paired columns checked by type, off the target's carried key and columns;
 * `mappedBy` by key alone, its kind checked on first read.
 */
type DefinedJoins<T, O, K = unknown, Columns = T> = {
  readonly key: KeyHolding<O, K>;
  readonly pairs: readonly DefinedJoinPair<O, Columns>[];
  readonly mappedBy: keyof T;
};

/** One pair of join columns, the local one holding what the target's column does. */
type DefinedJoinPair<O, Columns> = {
  readonly [F in keyof Columns]-?: { readonly local: KeyHolding<O, NonNullable<Columns[F]>>; readonly foreign: F };
}[keyof Columns];

/** What the first call of `defineEntity` states: the class, its table and its columns. */
export type DefineEntityOptions<F extends DefinedFields, B = object, BK = unknown, BC = unknown> = {
  /** The class's name, which a naming strategy derives the table's from, as it does a decorated class's. */
  readonly name: string;
  /** The table, exactly as the database names it, where it is not derived from `name`. */
  readonly table?: string;
  /** The schema (a MySQL database) the table lives in; unset follows the pool's. */
  readonly schema?: string;
  /** A base that is never a table: the entities extending it take what it declares. */
  readonly abstract?: true;
  /** The entity it inherits from, which the declared class extends, so its methods and `super` work. */
  readonly extends?: DefinedClass<B, BK, BC, boolean>;
  readonly fields: F;
};

/** A hook a defined entity runs on a row; a promise it returns is awaited. */
type DefinedHook<Row> = (row: Row, ctx: HookContext) => unknown;

/**
 * What a defined entity declares after its columns, each section typed by the columns now fixed, so none is inferred
 * again. `relations` comes last but for `filters`, which reads the row they complete.
 */
type DefinedSections<Row, Key, Columns, B, Abstract> = {
  /** Columns the database computes off the stored ones, `(post) => ({ slug: f.string().as(sql`...`) })`. */
  computed<const C extends DefinedComputed>(
    computed: (refs: RefMap<Columns>) => C,
  ): DefinedEntity<Row & ReadRow<C>, Key, Columns & ReadRow<C>, B, Abstract>;
  indexes(indexes: IndexSection<Columns>): DefinedEntity<Row, Key, Columns, B, Abstract>;
  checks(checks: CheckSection<Columns>): DefinedEntity<Row, Key, Columns, B, Abstract>;
  triggers(triggers: TriggerSection<Columns>): DefinedEntity<Row, Key, Columns, B, Abstract>;
  filters(filters: FilterSection<Row>): DefinedEntity<Row, Key, Columns, B, Abstract>;
  /** Functions each lifecycle event runs on the row, in order, given the querier writing it. */
  hooks(hooks: { readonly [E in HookEvent]?: readonly DefinedHook<Row>[] }): DefinedEntity<
    Row,
    Key,
    Columns,
    B,
    Abstract
  >;
  /**
   * The relations, each read lazily so entities pointing at each other declare in either order, and the values
   * read over the to-many ones, its base's too: `(author) => ({ postCount: () => author.posts.count() })`.
   */
  relations<const R, const A extends DerivedFields = {}>(
    relations: (rel: RelationBuilder<Columns>) => R,
    derived?: (refs: RefMap<Columns> & AggregateRefs<R> & ToManyRefs<B, Exclude<ToManyRelationKey<B>, keyof R>>) => A,
  ): RelatedEntity<Row & RelationRow<R> & DerivedRow<A>, Key, Columns, Abstract>;
};

/** A defined entity's class once its relations are in: its filters may follow, and read through them. */
export type RelatedEntity<Row, Key, Columns, Abstract = false> = DefinedClass<Row, Key, Columns, Abstract> & {
  filters(filters: FilterSection<Row>): DefinedClass<Row, Key, Columns, Abstract>;
};

/** A defined entity's class while its sections may still be declared. */
export type DefinedEntity<Row, Key, Columns, B, Abstract = false> = DefinedClass<Row, Key, Columns, Abstract> &
  DefinedSections<Row, Key, Columns, B, Abstract>;

/** The class `defineEntity` declares, to use as it is or to extend with behaviour; abstract for a base never a table. */
export type DefinedClass<Row, Key = unknown, Columns = unknown, Abstract = false> = (Abstract extends true
  ? abstract new () => Row
  : new () => Row) &
  DefinedShape<Key, Columns>;

declare const definedShape: unique symbol;

/**
 * What a relation or an aggregate pointing at a defined entity reads of it, its key's type and its columns, carried beside
 * its class rather than read off its row: the columns alone settle both while the row is still being inferred.
 */
type DefinedShape<Key, Columns = unknown> = {
  readonly [definedShape]?: { readonly key: Key; readonly columns: Columns };
};

/**
 * The key's type: its own column's, else the base's it inherits, `never` for a composite, which no one column can
 * reference, and anything for an entity defined from data, whose columns are known only at run time.
 */
export type DefinedKey<F, Inherited = unknown> = string extends keyof F
  ? unknown
  : FlagKeys<F, Column<{ readonly isId: true }>> extends infer K extends keyof F
    ? [K] extends [never]
      ? Inherited
      : true extends IsUnion<K>
        ? never
        : ColumnValueOf<F[K]>
    : never;
