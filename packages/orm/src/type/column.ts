import type { ForeignKeyAction } from '../schema/types.js';
import type { TYPE_BOUNDS, VALUE_DECIDERS } from '../util/fieldOption.util.js';
import type {
  ColumnType,
  DdlDefault,
  FamilyOf,
  FieldOptions,
  HasCompositeKey,
  IdValue,
  JsonColumnType,
  OnFieldCallback,
  StampEvent,
  TsTypeOf,
} from './entity.js';
import type { QuerySql } from './querySql.js';
import type { StandardSchemaV1 } from './standardSchema.js';
import type { Type, Json, JsonDocument, JsonScalar, AbstractType } from './utility.js';
import type { VectorDistance } from './vector.js';

/** Where a column builder holds its options, so every string key of a builder is a method. */
export const COLUMN_OPTIONS: unique symbol = Symbol('columnOptions');

/** What a builder has written and the value a row holds, carried for the type level alone: nothing sets it. */
export declare const COLUMN_TYPE: unique symbol;

/**
 * A column as `f` declares it: the options the registry reads, and for the type level the options written so
 * far, `O`, and the value a row holds, `V`, never `null`, which `nullable()` adds where the row is read.
 */
export type Column<O = unknown, V = unknown> = {
  readonly [COLUMN_OPTIONS]: FieldOptions;
  readonly [COLUMN_TYPE]?: { readonly options: O; readonly value: V };
};

/** The options a builder has written. */
export type ColumnOptionsOf<C> = C extends Column<infer O> ? O : never;

/** The value a column holds, `null` aside. */
export type ColumnValueOf<C> = C extends Column<unknown, infer V> ? V : never;

/** What a builder writes that lets an insert leave the column out: something fills it. */
export type FilledOptions =
  | { readonly defaultValue: unknown }
  | { readonly onInsert: unknown }
  | { readonly autoIncrement: true };

/** The `null` a column's row holds: none unless `nullable()` said so. */
export type NullOf<O> = O extends { readonly nullable: true } ? null : never;

/** A builder that has written none of `K`; the index signature keeps it from being a weak type every builder fails. */
type Lacking<K extends keyof FieldOptions> = Column<
  { readonly [P in K]?: undefined } & { readonly [key: string]: unknown }
>;

/** The options that decide what a column holds: a column the database writes takes none. */
type ValueDecider = (typeof VALUE_DECIDERS)[number];

/** What bounds a type: a column type written out as SQL carries its own. */
type TypeBound = (typeof TYPE_BOUNDS)[number];

/** A builder whose SQL type is not written out as `sql`, which is what leaves a bound a bound on the column. */
type TypeNotSql = Column<{ readonly columnType?: ColumnType } & { readonly [key: string]: unknown }>;

/** The builder of each column family, which is what keeps an option off a column it means nothing on. */
interface Builders<O, V> {
  readonly numeric: NumericColumn<O, V>;
  readonly string: StringColumn<O, V>;
  readonly date: DateColumn<O, V>;
  readonly boolean: ColumnBuilder<O, V, 'boolean'>;
  readonly json: ColumnBuilder<O, V, 'json'>;
  readonly blob: ColumnBuilder<O, V, 'blob'>;
  readonly vector: VectorColumn<O, V>;
  /** A column whose family is known only at run time: a foreign key's is its target key's, an entity defined at run time, its data's. */
  readonly any: ColumnBuilder<O, V, 'any'>;
}

type Family = keyof Builders<unknown, unknown>;

/** The same builder, having written `X` too. */
type With<O, V, X, F extends Family> = Builders<O & X, V>[F];

/** What every column takes. */
export interface ColumnBuilder<in out O, in out V, F extends Family> extends Column<O, V> {
  /** Lets the column hold `null`, which a read then answers with: a column is `NOT NULL` otherwise. */
  nullable(this: Lacking<'isId'>): With<O, V, { readonly nullable: true }, F>;
  /** Makes it the primary key, or a column of a composite one. */
  id(this: Lacking<'nullable' | 'autoIncrement'>): With<O, V, { readonly isId: true }, F>;
  /** The column's DDL default: a value, or SQL the database evaluates per row (`currentTimestamp`, `sql`). */
  default(value: DdlDefault<V> | QuerySql): With<O, V, { readonly defaultValue: unknown }, F>;
  /** The value uql writes on insert, where the row has none: a value, SQL or a function returning either. */
  onInsert(value: OnFieldCallback<V>): With<O, V, { readonly onInsert: unknown }, F>;
  /** The value uql writes on each update. */
  onUpdate(this: Lacking<'updatable'>, value: OnFieldCallback<V>): With<O, V, { readonly onUpdate: unknown }, F>;
  /** Leaves the column out of every update. */
  updatable(this: Lacking<'onUpdate'>, updatable: false): With<O, V, { readonly updatable: false }, F>;
  /** Makes a delete stamp the column instead, and reads skip stamped rows: `new Date()` unless given a value. */
  softDelete(value?: OnFieldCallback<V>): With<O, V, { readonly softDelete: unknown }, F>;
  unique(): With<O, V, { readonly unique: true }, F>;
  /** An index over the column, named or not; `false` keeps a foreign key column unindexed. */
  index(name?: string | false): With<O, V, { readonly index: unknown }, F>;
  /** The column's name, where it is not the field's. */
  name(column: string): With<O, V, { readonly name: string }, F>;
  comment(text: string): With<O, V, { readonly comment: string }, F>;
  /** Leaves the column out of a read naming no fields. */
  eager(eager: false): With<O, V, { readonly eager: false }, F>;
  /** The SQL type where it differs from the one the builder implies; an engine's own, `sql`citext``, verbatim. */
  columnType(type: ColumnType): With<O, V, { readonly columnType: ColumnType }, F>;
  columnType(this: Lacking<TypeBound>, type: QuerySql): With<O, V, { readonly columnType: QuerySql }, F>;
  /** A foreign key to `entity`'s key, which `@Field` holds its property to: `f.number().references(() => User)`. */
  references<C extends Type<object>>(entity: () => C): With<O, V, { readonly references: () => C }, F>;
  /** The foreign key's delete action. */
  onDelete(
    this: Column<{ readonly references: unknown }>,
    action: ForeignKeyAction,
  ): With<O, V, { readonly onDelete: ForeignKeyAction }, F>;
  /**
   * A column the database computes from `expression`, read in each query naming it; `stored()` keeps it. A relation
   * aggregate is no column's SQL: it is read on each query, so `@Computed` or `aggregates` declares one.
   */
  as(
    this: Lacking<ValueDecider | 'isId'>,
    expression: QuerySql & { readonly spec?: never },
  ): ComputedColumn<O & { readonly computed: QuerySql }, V>;
}

export interface NumericColumn<in out O, in out V> extends ColumnBuilder<O, V, 'numeric'> {
  /** Digits in all: a `DECIMAL`, read as a number where the builder is `f.number()`, rounding where it must. */
  precision(this: TypeNotSql, digits: number): NumericColumn<O & { readonly precision: number }, V>;
  scale(this: TypeNotSql, digits: number): NumericColumn<O & { readonly scale: number }, V>;
  /** Makes it the primary key, which the database generates. A key the caller supplies is `.id()`. */
  autoIncrement(
    this: Lacking<'nullable' | 'isId'>,
  ): NumericColumn<O & { readonly isId: true; readonly autoIncrement: true }, V>;
}

export interface StringColumn<in out O, in out V> extends ColumnBuilder<O, V, 'string'> {
  length(this: TypeNotSql, length: number): StringColumn<O & { readonly length: number }, V>;
}

export interface DateColumn<in out O, in out V> extends ColumnBuilder<O, V, 'date'> {
  /** Fractional-second digits. */
  precision(this: TypeNotSql, digits: number): DateColumn<O & { readonly precision: number }, V>;
}

export interface VectorColumn<in out O, in out V> extends ColumnBuilder<O, V, 'vector'> {
  dimensions(this: TypeNotSql, dimensions: number): VectorColumn<O & { readonly dimensions: number }, V>;
  /** The metric a search on it uses unless it names its own `$distance`; by default its vector index's, else cosine. */
  distance(distance: VectorDistance): VectorColumn<O & { readonly distance: VectorDistance }, V>;
}

/** A column the database computes, which nothing writes. */
export interface ComputedColumn<in out O, in out V> extends Column<O, V> {
  /**
   * Keeps it: a generated column, or with events a stamp a trigger writes on each, whoever writes the row,
   * which keeps a `currentTimestamp` current where `onUpdate` sees only uql's writes.
   */
  stored(events?: readonly StampEvent[]): ComputedColumn<O & { readonly stored: unknown }, V>;
}

/** The version column, an optimistic lock: an update matches the version it read and writes the next. */
export interface VersionColumn<in out O, in out V> extends Column<O, V> {
  name(column: string): VersionColumn<O & { readonly name: string }, V>;
  comment(text: string): VersionColumn<O & { readonly comment: string }, V>;
}

/** A JSON column of `T`, typed by the payload its schema validates to, or any document with none. */
type JsonColumn<T extends 'json' | 'jsonb'> = {
  <P extends JsonScalar | object = JsonDocument>(): ColumnBuilder<{ readonly type: T }, Json<P>, 'json'>;
  <S extends StandardSchemaV1>(
    schema: S,
  ): ColumnBuilder<{ readonly type: T; readonly schema: S }, JsonOutput<PayloadOf<S['~standard']['types']>>, 'json'>;
};

/** A schema's output as a JSON column holds it: a document, or the primitive a payload may be. */
type JsonOutput<O> = O extends JsonScalar | object | null ? Json<O> : Json;

/** The output a schema's `types` states, `unknown` where it states none: `never` would type the column as nothing. */
type PayloadOf<T> =
  NonNullable<T> extends infer N
    ? [N] extends [never]
      ? unknown
      : N extends { readonly output: infer O }
        ? O
        : unknown
    : never;

/** The key a column referencing `C` holds, or a named complaint for a composite one, which no one column holds. */
type ReferenceValue<C> =
  C extends AbstractType<infer E>
    ? HasCompositeKey<E> extends true
      ? { readonly __compositeKeyNeedsAColumnPerKey: true }
      : NonNullable<IdValue<E>>
    : never;

/** The builder of a SQL type, its value what the type reads as: a family alone does not say, `time` and a decimal being text. */
type ColumnOf<T extends ColumnType> = [FamilyOf<T>] extends [never]
  ? ColumnBuilder<{ readonly type: ColumnType }, unknown, 'any'>
  : Builders<{ readonly type: T }, T extends JsonColumnType ? Json : TsTypeOf<T>>[FamilyOf<T>];

/**
 * The builders, one per value a column holds; `column` takes any SQL type, its family deciding what it offers. A
 * scalar's or a document's type argument narrows what a row holds, a brand or a payload: `f.uuid<UserId>()`.
 */
export type ColumnFactory = {
  string<V extends string = string>(): StringColumn<{ readonly type: StringConstructor }, V>;
  text<V extends string = string>(): StringColumn<{ readonly type: 'text' }, V>;
  uuid<V extends string = string>(): StringColumn<{ readonly type: 'uuid' }, V>;
  number<V extends number = number>(): NumericColumn<{ readonly type: NumberConstructor }, V>;
  bigint<V extends bigint = bigint>(): NumericColumn<{ readonly type: BigIntConstructor }, V>;
  /** An exact decimal, read as its text: a JS number would round it. `f.number().precision()` opts in to that. */
  decimal<V extends string = string>(): NumericColumn<{ readonly type: 'decimal' }, V>;
  decimal<V extends string = string>(
    precision: number,
  ): NumericColumn<{ readonly type: 'decimal'; readonly precision: number }, V>;
  decimal<V extends string = string>(
    precision: number,
    scale: number,
  ): NumericColumn<{ readonly type: 'decimal'; readonly precision: number; readonly scale: number }, V>;
  boolean(): ColumnBuilder<{ readonly type: BooleanConstructor }, boolean, 'boolean'>;
  date<V extends Date = Date>(): DateColumn<{ readonly type: DateConstructor }, V>;
  json: JsonColumn<'json'>;
  jsonb: JsonColumn<'jsonb'>;
  vector(dimensions: number): VectorColumn<{ readonly type: 'vector'; readonly dimensions: number }, readonly number[]>;
  /** The values the column accepts, a `CHECK (col IN (...))` on every SQL engine, and the row's literal union. */
  enum<const M extends readonly string[]>(
    members: M,
  ): StringColumn<{ readonly type: StringConstructor; readonly enum: M }, M[number]>;
  enum<const M extends readonly number[]>(
    members: M,
  ): NumericColumn<{ readonly type: NumberConstructor; readonly enum: M }, M[number]>;
  /**
   * The optimistic lock: `NOT NULL DEFAULT 0`, and the class's `[versionKey]` brand makes each update carry it. A
   * `BigInt` one counts past 2^53.
   */
  version(): VersionColumn<{ readonly type: NumberConstructor; readonly version: true }, number>;
  version(type: BigIntConstructor): VersionColumn<{ readonly type: BigIntConstructor; readonly version: true }, bigint>;
  /** A column of SQL type `type`, offering what its family takes, or what any does where its type is data. */
  column<T extends ColumnType>(type: T): ColumnOf<T>;
  /** A foreign key to `entity`'s key, its column typed as that key is. */
  references<C extends Type<object>>(
    entity: () => C,
  ): ColumnBuilder<{ readonly references: () => C }, ReferenceValue<C>, 'any'>;
};
