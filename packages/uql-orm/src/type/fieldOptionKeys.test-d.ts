import { Entity, Field, Id } from '../entity/index.js';
import { raw } from '../util/index.js';
import type { Json } from './utility.js';

/** A typo'd option used to compile and be silently ignored: the decorators capture a naked type
 * parameter, and TypeScript skips excess-property checking on one of those. */
@Entity()
class TypoRejected {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - 'nulable' is not an option
  @Field({ type: String, nulable: true }) a?: string;
  // @ts-expect-error - registration works this out; it is not authorable
  @Field({ type: String, typeFromReference: true }) b?: string;
  // @ts-expect-error - likewise
  @Field({ type: String, referencedKey: 'id' }) c?: string;
}

@Entity()
class RealOptionsStillCompile {
  // @ts-expect-error - 'isd' is not an option
  @Id({ type: Number, isd: true }) id?: number;
  @Field({ type: String, name: 'the_name', nullable: false, unique: true, index: true }) a?: string;
  @Field({ type: Number, precision: 10, scale: 2, defaultValue: 0 }) b?: number;
}

/** An option the column cannot use is the same mistake one level deeper, so it reads the same way. */
@Entity()
class IncompatibleRejected {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - a serial is a numeric column's
  @Field({ type: String, autoIncrement: true }) a?: string;
  // @ts-expect-error - 'dimensions' belongs to a vector column
  @Field({ type: String, dimensions: 3 }) b?: string;
  // @ts-expect-error - 'length' belongs to a string column
  @Field({ type: Number, length: 10 }) c?: number;
  // @ts-expect-error - 'precision' belongs to a numeric column
  @Field({ type: String, precision: 10 }) d?: string;
  // @ts-expect-error - a virtual field is never in the DDL, so its index would never be created
  @Field({ type: Number, virtual: raw`1`, index: true }) e?: number;
  // @ts-expect-error - an update never carries the field, so the callback could not fire
  @Field({ type: Number, updatable: false, onUpdate: () => 1 }) f?: number;
  // @ts-expect-error - a primary key is NOT NULL in every engine
  @Field({ type: String, isId: true, nullable: true }) g?: string;
  // @ts-expect-error - likewise, where '@Id' is what adds the 'isId'
  @Id({ type: Number, nullable: true }) h?: number;
  // @ts-expect-error - the DDL default is the value the column holds
  @Field({ type: Number, defaultValue: 'hello' }) i?: number;
}

/** The combinations that do apply, including the ones the check must not read as contradictions. */
@Entity()
class CompatibleStillCompiles {
  // `nullable: false` states what a key already is, so it agrees with the column rather than
  // contradicting it - unlike the `nullable: true` above.
  @Id({ type: Number, autoIncrement: true, nullable: false }) id?: number;
  @Field({ type: 'vector', dimensions: 3, distance: 'cosine' }) vec?: number[];
  // The column type is what the options are judged against, not the property's own type.
  @Field({ type: String, columnType: 'decimal', precision: 30, scale: 2 }) exact?: string;
  // A JSON column defaults with the SQL literal it stores.
  @Field({ type: 'jsonb', defaultValue: '{}' }) settings?: Json<{ theme?: string }>;
  @Field({ type: Number, virtual: raw`1`, eager: false }) computed?: number;
  @Field({ type: Date, softDelete: true, index: true }) deletedAt?: Date;
}

export type _ = [TypoRejected, RealOptionsStillCompile, IncompatibleRejected, CompatibleStillCompiles];
