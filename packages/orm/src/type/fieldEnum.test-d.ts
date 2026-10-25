import { Entity, f, Field } from '../entity/index.js';

@Entity()
class Narrowed {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(['draft', 'paid']).nullable()) status?: 'draft' | 'paid' | null;
}

@Entity()
class PropertyWiderThanEnum {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - the property admits a value the column would reject
  @Field(f.enum(['draft', 'paid']).nullable()) status?: 'draft' | 'paid' | 'void' | null;
}

@Entity()
class ValueOutsideFieldType {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - a number is not one of a String field's values
  @Field(f.enum(['draft', 2]).nullable()) status?: 'draft' | 2 | null;
}

@Entity()
class NumericNarrowed {
  @Field(f.number().id()) id?: number;
  @Field(f.enum([1, 2]).nullable()) level?: 1 | 2 | null;
}

@Entity()
class ValuesCannotBeStated {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - a set of dates is not something IN (...) can state
  @Field({ type: Date, enum: [new Date()] as const }) at?: Date | null;
}

/** `f.enum` reads its members as written, so a literal list narrows without `as const`. */
@Entity()
class WithoutAsConst {
  @Field(f.number().id()) id?: number;
  @Field(f.enum(['draft', 'paid']).nullable()) status?: 'draft' | 'paid' | null;
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
  @Field(f.number().id()) id?: number;
  @Field(f.enum(Object.values(Status)).nullable()) status?: Status | null;
}

@Entity()
class TsEnumMembers {
  @Field(f.number().id()) id?: number;
  @Field(f.enum([Status.Draft, Status.Paid]).nullable()) status?: Status | null;
}

@Entity()
class TsEnumSubset {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - the property admits Paid, which the column would reject
  @Field(f.enum([Status.Draft]).nullable()) status?: Status | null;
}

@Entity()
class TsEnumLiteralProperty {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - a TS enum is nominal, so its literal union is not one of its members
  @Field(f.enum(Object.values(Status)).nullable()) status?: 'draft' | 'paid' | null;
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
  @Field(f.number().id()) id?: number;
  @Field(f.enum([Level.Low, Level.High]).nullable()) level?: Level | null;
}

@Entity()
class NumericTsEnumValues {
  @Field(f.number().id()) id?: number;
  // @ts-expect-error - Object.values on a numeric enum also yields the reverse-mapped names
  @Field(f.enum(Object.values(Level)).nullable()) level?: Level | null;
}

@Entity()
class NumericLiterals {
  @Field(f.number().id()) id?: number;
  @Field(f.enum([0, 1]).nullable()) level?: 0 | 1 | null;
}

export type _ = [
  Narrowed,
  PropertyWiderThanEnum,
  ValueOutsideFieldType,
  NumericNarrowed,
  ValuesCannotBeStated,
  WithoutAsConst,
  TsEnumValues,
  TsEnumMembers,
  TsEnumSubset,
  TsEnumLiteralProperty,
  NumericTsEnum,
  NumericTsEnumValues,
  NumericLiterals,
];
