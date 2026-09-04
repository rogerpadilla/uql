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

export type _ = [
  Narrowed,
  PropertyWiderThanEnum,
  ValueOutsideFieldType,
  NumericNarrowed,
  ValuesCannotBeStated,
  ForgotAsConst,
];
