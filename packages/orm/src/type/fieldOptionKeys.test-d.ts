import { Computed, Entity, f, Field } from '../entity/index.js';
import { sql } from '../util/index.js';
import { idKey, versionKey } from './entity.js';
import type { Json } from './utility.js';

/** A typo'd option is a method the builder has not got. */
@Entity()
class TypoRejected {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - 'nulable' is not an option
  @Field(f.string().nulable()) a?: string | null;
}

@Entity()
class RealOptionsStillCompile {
  @Field(f.number().id()) id?: number;
  @Field(f.string().unique().index().name('the_name')) a?: string;
  @Field(f.number().nullable().default(0).precision(10).scale(2)) b?: number | null;
}

/** An option the column cannot use is the same mistake one level deeper, so it reads the same way. */
@Entity()
class IncompatibleRejected {
  [idKey]?: 'id' | 'g';
  // One brand satisfies the decorator's "a lock is declared in both halves" check for every case below.
  [versionKey]?: 'j';

  @Field(f.number().id()) id?: number;
  // @ts-expect-error - a serial is a numeric column's
  @Field(f.string().nullable().autoIncrement()) a?: string | null;
  // @ts-expect-error - 'dimensions' belongs to a vector column
  @Field(f.string().nullable().dimensions(3)) b?: string | null;
  // @ts-expect-error - 'length' belongs to a string column
  @Field(f.number().nullable().length(10)) c?: number | null;
  // @ts-expect-error - 'precision' belongs to a numeric or a date column
  @Field(f.string().nullable().precision(10)) d?: string | null;
  @Field(f.date().nullable().precision(3)) d2?: Date | null;
  @Computed((row) =>
    f
      .number()
      .nullable()
      // @ts-expect-error - the refs a computed callback reads are the entity's fields
      .as(sql`${row.nope} + 1`),
  )
  e?: number | null;
  @Field(
    // @ts-expect-error - an update never carries the field, so the callback could not fire
    f
      .number()
      .nullable()
      .onUpdate(() => 1)
      .updatable(false),
  )
  f?: number | null;
  // @ts-expect-error - a primary key is NOT NULL in every engine
  @Field(f.string().id().nullable()) g?: string;
  // @ts-expect-error - the DDL default is the value the column holds
  @Field(f.number().nullable().default('hello')) i?: number | null;
  // @ts-expect-error - the querier writes the version on every update, so nothing else may decide it
  @Field(f.version().onUpdate(() => 1)) j?: number;
  // @ts-expect-error - a version starts at 0 and the lock owns it from there
  @Field(f.version().default(7)) k?: number;
  // @ts-expect-error - a version is NOT NULL, since every row has to have one to be matched by it
  @Field(f.version()) l?: number | null;
  // @ts-expect-error - a version counts updates, which a string column cannot
  @Field(f.string().version()) m?: string;
  // the lock itself, declared in both halves, compiles
  @Field(f.version()) j2?: number;
}

/** Half a lock is no lock: a version without the brand leaves an update payload free of it. */
@Entity()
class UnbrandedVersionRejected {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - the entity has to brand the property with 'versionKey' as well
  @Field(f.version()) version?: number;
}

/** The combinations that do apply. */
@Entity()
class CompatibleStillCompiles {
  @Field(f.number().id().autoIncrement()) id?: number;
  @Field(f.vector(3).nullable().distance('cosine')) vec?: number[] | null;
  // An exact decimal reads as its text.
  @Field(f.decimal(30, 2).nullable()) exact?: string | null;
  // A JSON column defaults with the SQL literal it stores.
  @Field(f.jsonb().nullable().default('{}')) settings?: Json<{ theme?: string }> | null;
  @Computed(() =>
    f
      .number()
      .nullable()
      .eager(false)
      .as(sql`1`),
  )
  computed?: number | null;
  @Computed((row) =>
    f
      .number()
      .nullable()
      .as(sql`${row.computed} + 1`)
      .stored(),
  )
  next?: number | null;
  @Field(f.date().nullable().softDelete().index()) deletedAt?: Date | null;
  // An engine's own type, which no family models: a `sql` constant, never a bare string, so a
  // misspelling cannot pass for one.
  @Field(
    f
      .string()
      .nullable()
      .eager(false)
      .columnType(sql`tsvector`),
  )
  searchVector?: string | null;
}

/** A column type uql does not model is spelled `sql`, which is what keeps a typo from becoming one. */
@Entity()
class UnknownColumnTypeRejected {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error a bare string names one of the types uql models, and this is not one
  @Field(f.string().nullable().columnType('tsvector')) vector?: string | null;
  // @ts-expect-error which is what catches a misspelling of one that is
  @Field(f.string().nullable().columnType('varchr')) typo?: string | null;
  @Field(
    // @ts-expect-error a type written out carries its own bounds, so one stated beside it is unread
    f
      .string()
      .nullable()
      .length(100)
      .columnType(sql`ltree`),
  )
  bounded?: string | null;
}

export type _ = [
  UnknownColumnTypeRejected,
  TypoRejected,
  RealOptionsStillCompile,
  IncompatibleRejected,
  UnbrandedVersionRejected,
  CompatibleStillCompiles,
];
