import { Entity, Field, Id } from '../entity/index.js';
import { raw } from '../util/index.js';
import { versionKey } from './entity.js';
import type { Json } from './utility.js';

/**
 * A typo'd option is a compile error, although the decorators capture a naked type parameter, on which
 * TypeScript skips excess-property checking.
 */
@Entity()
class TypoRejected {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - 'nulable' is not an option
  @Field({ type: String, nulable: true }) a?: string | null;
  // @ts-expect-error - registration works this out; it is not authorable
  @Field({ type: String, typeFromReference: true }) b?: string | null;
}

@Entity()
class RealOptionsStillCompile {
  // @ts-expect-error - 'isd' is not an option
  @Id({ type: Number, isd: true }) id?: number;
  @Field({ type: String, name: 'the_name', nullable: false, unique: true, index: true }) a?: string;
  @Field({ type: Number, precision: 10, scale: 2, defaultValue: 0 }) b?: number | null;
}

/** An option the column cannot use is the same mistake one level deeper, so it reads the same way. */
@Entity()
class IncompatibleRejected {
  // One brand satisfies the decorator's "a lock is declared in both halves" check for every case below.
  [versionKey]?: 'j';

  @Id({ type: Number }) id?: number;
  // @ts-expect-error - a serial is a numeric column's
  @Field({ type: String, autoIncrement: true }) a?: string | null;
  // @ts-expect-error - 'dimensions' belongs to a vector column
  @Field({ type: String, dimensions: 3 }) b?: string | null;
  // @ts-expect-error - 'length' belongs to a string column
  @Field({ type: Number, length: 10 }) c?: number | null;
  // @ts-expect-error - 'precision' belongs to a numeric or a date column
  @Field({ type: String, precision: 10 }) d?: string | null;
  @Field({ type: Date, precision: 3 }) d2?: Date | null;
  // @ts-expect-error - an inlined computed field is never in the DDL, so its index would never be created
  @Field({ type: Number, computed: raw`1`, index: true }) e?: number | null;
  // @ts-expect-error - the refs a computed callback reads are the entity's fields
  @Field({ type: Number, computed: (row) => raw`${row.nope} + 1` }) e3?: number | null;
  // @ts-expect-error - not an option: an expression the database computes is 'computed'
  @Field({ type: Number, virtual: raw`1` }) e2?: number | null;
  // @ts-expect-error - an update never carries the field, so the callback could not fire
  @Field({ type: Number, updatable: false, onUpdate: () => 1 }) f?: number | null;
  // @ts-expect-error - a primary key is NOT NULL in every engine
  @Field({ type: String, isId: true, nullable: true }) g?: string;
  // @ts-expect-error - likewise, where '@Id' is what adds the 'isId'
  @Id({ type: Number, nullable: true }) h?: number;
  // @ts-expect-error - the DDL default is the value the column holds
  @Field({ type: Number, defaultValue: 'hello' }) i?: number | null;
  // @ts-expect-error - the querier writes the version on every update, so nothing else may decide it
  @Field({ type: Number, version: true, onUpdate: () => 1 }) j?: number;
  // @ts-expect-error - a version starts at 0 and the lock owns it from there
  @Field({ type: Number, version: true, defaultValue: 7 }) k?: number;
  // @ts-expect-error - a version is NOT NULL, since every row has to have one to be matched by it
  @Field({ type: Number, version: true, nullable: true }) l?: number | null;
  // @ts-expect-error - a version counts updates, which a string column cannot
  @Field({ type: String, version: true }) m?: string;
  // the lock itself, declared in both halves, compiles
  @Field({ type: Number, version: true }) j2?: number;
}

/** Half a lock is no lock: `version: true` without the brand leaves an update payload free of it. */
@Entity()
class UnbrandedVersionRejected {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - the entity has to brand the property with 'versionKey' as well
  @Field({ type: Number, version: true }) version?: number;
}

/** The combinations that do apply, including the ones the check must not read as contradictions. */
@Entity()
class CompatibleStillCompiles {
  // `nullable: false` states what a key already is, so it agrees with the column rather than
  // contradicting it - unlike the `nullable: true` above.
  @Id({ type: Number, autoIncrement: true, nullable: false }) id?: number;
  @Field({ type: 'vector', dimensions: 3, distance: 'cosine' }) vec?: number[] | null;
  // The column type is what the options are judged against, not the property's own type.
  @Field({ type: String, columnType: 'decimal', precision: 30, scale: 2 }) exact?: string | null;
  // A JSON column defaults with the SQL literal it stores.
  @Field({ type: 'jsonb', defaultValue: '{}' }) settings?: Json<{ theme?: string }> | null;
  @Field({ type: Number, computed: raw`1`, eager: false }) computed?: number | null;
  @Field({ type: Number, computed: (row) => raw`${row.computed} + 1`, stored: true }) next?: number | null;
  @Field({ type: Date, softDelete: true, index: true }) deletedAt?: Date | null;
  // An engine's own type, which no family models: a `raw` constant, never a bare string, so a
  // misspelling cannot pass for one.
  @Field({ type: String, columnType: raw`tsvector`, eager: false }) searchVector?: string | null;
}

/** A column type uql does not model is spelled `raw`, which is what keeps a typo from becoming one. */
@Entity()
class UnknownColumnTypeRejected {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error a bare string names one of the types uql models, and this is not one
  @Field({ type: String, columnType: 'tsvector' }) vector?: string | null;
  // @ts-expect-error which is what catches a misspelling of one that is
  @Field({ type: String, columnType: 'varchr' }) typo?: string | null;
  // @ts-expect-error a type written out carries its own bounds, so one stated beside it is unread
  @Field({ type: String, columnType: raw`ltree`, length: 100 }) bounded?: string | null;
}

export type _ = [
  UnknownColumnTypeRejected,
  TypoRejected,
  RealOptionsStillCompile,
  IncompatibleRejected,
  UnbrandedVersionRejected,
  CompatibleStillCompiles,
];
