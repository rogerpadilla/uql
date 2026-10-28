import type { ForeignKeyAction } from '../schema/types.js';
import type { TYPE_BOUNDS, VALUE_DECIDERS } from '../util/fieldOption.util.js';
import type { ReferencedKey } from './definedEntity.js';
import type {
  BlobColumnType,
  BooleanColumnType,
  ColumnType,
  DateColumnType,
  DdlDefault,
  JsonColumnType,
  NumericColumnType,
  StringColumnType,
  VectorColumnType,
  FieldOptions,
  HasCompositeKey,
  IdValue,
  JoinKind,
  OnFieldCallback,
  StampEvent,
} from './entity.js';
import type { QuerySql } from './querySql.js';
import type { StandardSchemaV1 } from './standardSchema.js';
import type { Type, Json, AbstractType } from './utility.js';
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
  id(this: Lacking<'nullable'>): With<O, V, { readonly isId: true }, F>;
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
  /** A foreign key to `entity`'s key, which the column has to hold the kind of: `f.number().references(() => User)`. */
  references<C extends Type<object>>(entity: () => C & HoldsKey<C, V>): With<O, V, { readonly references: () => C }, F>;
  /** The foreign key's delete action. */
  onDelete(
    this: Column<{ readonly references: unknown }>,
    action: ForeignKeyAction,
  ): With<O, V, { readonly onDelete: ForeignKeyAction }, F>;
  /** Narrows the value a row holds, a branded id or a literal union: `f.uuid().narrow<UserId>()`. */
  narrow<T extends V>(): Builders<O, T>[F];
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
  /** Has the database generate the value, which a numeric sole key does unless `autoIncrement(false)` says otherwise. */
  autoIncrement(): NumericColumn<O & { readonly autoIncrement: true }, V>;
  autoIncrement(generated: false): NumericColumn<O & { readonly autoIncrement: false }, V>;
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

/** Refuses a target whose key is another kind of value than the column holds, which no join matches. */
type HoldsKey<C, V> = [JoinKind<NonNullable<ReferencedKey<C>>>] extends [JoinKind<V>]
  ? unknown
  : { readonly __columnMustHoldReferencedKey: ReferencedKey<C> };

/** The column types holding an exact decimal, read as its text: a JS number would round it. */
type DecimalType = 'decimal' | 'numeric';

/** A JSON column of `T`, typed by the payload its schema validates to, or any document with none. */
type JsonColumn<T extends 'json' | 'jsonb'> = {
  (): ColumnBuilder<{ readonly type: T }, Json, 'json'>;
  <S extends StandardSchemaV1>(
    schema: S,
  ): ColumnBuilder<{ readonly type: T; readonly schema: S }, JsonOutput<PayloadOf<S['~standard']['types']>>, 'json'>;
};

/** A schema's output as a JSON column holds it: a document, or the primitive a payload may be. */
type JsonOutput<O> = O extends object | string | number | boolean | null ? Json<O> : Json;

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

/** The builders, one per value a column holds; `column` takes any SQL type, its family deciding what it offers. */
export type ColumnFactory = {
  string(): StringColumn<{ readonly type: StringConstructor }, string>;
  text(): StringColumn<{ readonly type: 'text' }, string>;
  uuid(): StringColumn<{ readonly type: 'uuid' }, string>;
  number(): NumericColumn<{ readonly type: NumberConstructor }, number>;
  bigint(): NumericColumn<{ readonly type: BigIntConstructor }, bigint>;
  /** An exact decimal, read as its text: a JS number would round it. `f.number().precision()` opts in to that. */
  decimal(): NumericColumn<{ readonly type: 'decimal' }, string>;
  decimal(precision: number): NumericColumn<{ readonly type: 'decimal'; readonly precision: number }, string>;
  decimal(
    precision: number,
    scale: number,
  ): NumericColumn<{ readonly type: 'decimal'; readonly precision: number; readonly scale: number }, string>;
  boolean(): ColumnBuilder<{ readonly type: BooleanConstructor }, boolean, 'boolean'>;
  date(): DateColumn<{ readonly type: DateConstructor }, Date>;
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
  /** A column of SQL type `type`, offering what its family takes. */
  column(type: DecimalType): NumericColumn<{ readonly type: DecimalType }, string>;
  column(
    type: Exclude<NumericColumnType, DecimalType>,
  ): NumericColumn<{ readonly type: NumericColumnType }, number | bigint>;
  column(type: StringColumnType): StringColumn<{ readonly type: StringColumnType }, string>;
  column(type: 'time'): DateColumn<{ readonly type: 'time' }, string>;
  column(type: Exclude<DateColumnType, 'time'>): DateColumn<{ readonly type: DateColumnType }, Date>;
  column(type: VectorColumnType): VectorColumn<{ readonly type: VectorColumnType }, readonly number[]>;
  column(type: BooleanColumnType): ColumnBuilder<{ readonly type: BooleanColumnType }, boolean, 'boolean'>;
  column(type: JsonColumnType): ColumnBuilder<{ readonly type: JsonColumnType }, Json, 'json'>;
  column(type: BlobColumnType): ColumnBuilder<{ readonly type: BlobColumnType }, Uint8Array, 'blob'>;
  /** A column whose type is data, as an entity defined at run time declares one. */
  column(type: ColumnType): ColumnBuilder<{ readonly type: ColumnType }, unknown, 'any'>;
  /** A foreign key to `entity`'s key, its column typed as that key is. */
  references<C extends Type<object>>(
    entity: () => C,
  ): ColumnBuilder<{ readonly references: () => C }, ReferenceValue<C>, 'any'>;
};
