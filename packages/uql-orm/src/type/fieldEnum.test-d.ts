import { Entity, Field, Id } from '../entity/index.js';

@Entity()
class Narrowed {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: ['draft', 'paid'] as const }) status?: 'draft' | 'paid';
}

@Entity()
class PropertyWiderThanEnum {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - the property admits a value the column would reject
  @Field({ type: String, enum: ['draft', 'paid'] as const }) status?: 'draft' | 'paid' | 'void';
}

@Entity()
class ValueOutsideFieldType {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - a number is not one of a String field's values
  @Field({ type: String, enum: ['draft', 2] as const }) status?: 'draft' | 2;
}

@Entity()
class NumericNarrowed {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number, enum: [1, 2] as const }) level?: 1 | 2;
}

@Entity()
class ValuesCannotBeStated {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - a set of dates is not something IN (...) can state
  @Field({ type: Date, enum: [new Date()] as const }) at?: Date;
}

/**
 * Widened values narrow nothing, so the check would be silently off. It is an error instead - the
 * property is narrowed to `__enumNeedsAsConst`, which nothing can hold, and the name says the cause.
 */
@Entity()
class ForgotAsConst {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - '"draft" | "paid"' is not assignable to '{ __enumNeedsAsConst: true }'
  @Field({ type: String, enum: ['draft', 'paid'] }) status?: 'draft' | 'paid';
}

/**
 * A string enum's members already infer narrower than `string`, so `Object.values` needs no
 * `as const` - there is nothing left to widen.
 */
enum Status {
  Draft = 'draft',
  Paid = 'paid',
}

@Entity()
class TsEnumValues {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: Object.values(Status) }) status?: Status;
}

@Entity()
class TsEnumMembers {
  @Id({ type: Number }) id?: number;
  @Field({ type: String, enum: [Status.Draft, Status.Paid] as const }) status?: Status;
}

@Entity()
class TsEnumSubset {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - the property admits Paid, which the column would reject
  @Field({ type: String, enum: [Status.Draft] as const }) status?: Status;
}

@Entity()
class TsEnumLiteralProperty {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - a TS enum is nominal, so its literal union is not one of its members
  @Field({ type: String, enum: Object.values(Status) }) status?: 'draft' | 'paid';
}

/**
 * Numeric enums are assignable from `number` both ways, so their members narrow nothing and the
 * widening guard fires. A numeric column states its values as literals instead.
 */
enum Level {
  Low = 0,
  High = 1,
}

@Entity()
class NumericTsEnum {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - 'Level' is not assignable to '{ __enumNeedsAsConst: true }'
  @Field({ type: Number, enum: [Level.Low, Level.High] as const }) level?: Level;
}

@Entity()
class NumericTsEnumValues {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - Object.values on a numeric enum also yields the reverse-mapped names
  @Field({ type: Number, enum: Object.values(Level) }) level?: Level;
}

@Entity()
class NumericLiterals {
  @Id({ type: Number }) id?: number;
  @Field({ type: Number, enum: [0, 1] as const }) level?: 0 | 1;
}

export type _ = [
  Narrowed,
  PropertyWiderThanEnum,
  ValueOutsideFieldType,
  NumericNarrowed,
  ValuesCannotBeStated,
  ForgotAsConst,
  TsEnumValues,
  TsEnumMembers,
  TsEnumSubset,
  TsEnumLiteralProperty,
  NumericTsEnum,
  NumericTsEnumValues,
  NumericLiterals,
];
