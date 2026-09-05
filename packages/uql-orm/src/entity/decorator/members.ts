import type {
  EntityGetter,
  FieldOptions,
  FieldType,
  HookEvent,
  IdValue,
  RelationManyToManyOptions,
  RelationManyToOneOptions,
  RelationOneToManyOptions,
  RelationOneToOneOptions,
  RelationOptions,
  TsTypeOf,
} from '../../type/index.js';
import { memberRegistrations } from './bag.js';

// The member decorators share one mechanism, which is why they share a file: the standard spec gives a
// member decorator no reference to its class, so each records what it was told on `context.metadata` and
// `@Entity()` drains it (see `bag.ts`). What they add on top is checking, by pinning the context's value
// type: the `type`, `entity` or referenced key a decorator declares is compared against the property it is
// written on.

/** A member decorator that also constrains the property it may be applied to. */
type MemberDecorator<V> = (value: undefined, context: ClassFieldDecoratorContext<unknown, V>) => void;

/**
 * The property type a set of field options describes, in the same order schema generation resolves the
 * column: a declared `type` wins, and otherwise the column - and so the property - is the referenced
 * primary key's own type. Which is what makes `@Field({ references: () => User })` on a `number`, where
 * `User.id` is a `uuid`, a compile error rather than a column that disagrees with its property.
 */
/**
 * Maps any option the type does not declare to `never`, turning a typo into a compile error.
 *
 * Needed because the decorators capture their options as a naked type parameter, and TypeScript
 * skips excess-property checking on one of those: `@Field({ nulable: true })` compiled and was
 * silently ignored. Resolves to `unknown` - an inert intersection member - when there are none.
 */
type RejectUnknown<O, Known> = [Exclude<keyof O, keyof Known>] extends [never]
  ? unknown
  : Record<Exclude<keyof O, keyof Known> & string, never>;

/**
 * The value type the options declare, which the decorated property is then checked against.
 *
 * `enum` narrows it to its own values, so the property must spell out the same set. Only the values
 * the declared `type` admits count, which is what keeps `enum: [2]` off a `String` field.
 */
type DeclaredValue<O> = O extends { readonly type: infer T extends FieldType }
  ? O extends { readonly enum: infer E extends readonly unknown[] }
    ? EnumValue<Extract<E[number], TsTypeOf<T>>, TsTypeOf<T>>
    : TsTypeOf<T>
  : O extends { readonly references: EntityGetter<infer E> }
    ? IdValue<E>
    : never;

/**
 * The enum's members, or a named complaint when they widened.
 *
 * `['a', 'b']` without `as const` infers `string[]`, whose member type is the field's own type and
 * so narrows nothing - the check would be silently off. Resolving to a type no property can hold
 * makes that a compile error that says why, rather than a decoration.
 */
type EnumValue<Members, Declared> = Declared extends Members ? { readonly __enumNeedsAsConst: true } : Members;

/**
 * Declares a persisted field.
 *
 * `@Field({ type: String })` on a `number` property is a compile error rather than a silent TEXT column,
 * which is what makes the now-mandatory `type` worth stating.
 *
 * @example `@Field({ type: String }) name?: string;`
 * @example `@Field({ references: () => User }) userId?: string;` (where `User.id` is a `uuid`)
 */
export function Field<
  O extends FieldOptions<DeclaredValue<O>> &
    ({ type: FieldType } | { references: EntityGetter }) &
    RejectUnknown<O, FieldOptions>,
>(opts: O): MemberDecorator<DeclaredValue<O> | undefined> {
  return (_value, context) => {
    memberRegistrations(context.metadata).fields[String(context.name)] = opts;
  };
}

/**
 * Declares the primary key, checked the same way as `@Field`.
 *
 * @example `@Id({ type: Number }) id?: number;`
 * @example `@Id({ type: 'uuid', onInsert: uuidv7 }) id?: string;`
 */
export function Id<O extends FieldOptions<DeclaredValue<O>> & { type: FieldType } & RejectUnknown<O, FieldOptions>>(
  opts: O,
): MemberDecorator<DeclaredValue<O> | undefined> {
  return (_value, context) => {
    memberRegistrations(context.metadata).fields[String(context.name)] = { ...opts, isId: true };
  };
}

/**
 * `E` comes from the mandatory `entity` getter, so the context can insist the property really holds that
 * entity: `@ManyToOne({ entity: () => Other })` on a `Company` field stops compiling, and a to-many
 * cardinality on a non-array property does too. `entity` is required because nothing reflects it now.
 */
type WithEntity<E, O> = O & { readonly entity: EntityGetter<E> };

function relation<V>(opts: RelationOptions): MemberDecorator<V> {
  return (_value, context) => {
    memberRegistrations(context.metadata).relations[String(context.name)] = opts;
  };
}

export function OneToOne<E>(opts: WithEntity<E, RelationOneToOneOptions<E>>): MemberDecorator<E | undefined> {
  return relation<E | undefined>({ cardinality: '11', ...opts });
}

export function ManyToOne<E>(opts: WithEntity<E, RelationManyToOneOptions<E>>): MemberDecorator<E | undefined> {
  return relation<E | undefined>({ cardinality: 'm1', ...opts });
}

export function OneToMany<E>(
  opts: WithEntity<E, RelationOneToManyOptions<E>>,
): MemberDecorator<readonly E[] | undefined> {
  return relation<readonly E[] | undefined>({ cardinality: '1m', ...opts });
}

export function ManyToMany<E>(
  opts: WithEntity<E, RelationManyToManyOptions<E>>,
): MemberDecorator<readonly E[] | undefined> {
  return relation<readonly E[] | undefined>({ cardinality: 'mm', ...opts });
}

function hook(event: HookEvent) {
  return () =>
    // Generic in `This` so a hook declared with an explicit `this` parameter still matches; the default
    // on `ClassMethodDecoratorContext` pins `this` to `unknown` and would reject it.
    <This>(_value: unknown, context: ClassMethodDecoratorContext<This>): void => {
      const { hooks } = memberRegistrations(context.metadata);
      hooks[event] ??= [];
      hooks[event].push(String(context.name));
    };
}

export const BeforeInsert = hook('beforeInsert');
export const AfterInsert = hook('afterInsert');
export const BeforeUpdate = hook('beforeUpdate');
export const AfterUpdate = hook('afterUpdate');
export const BeforeDelete = hook('beforeDelete');
export const AfterDelete = hook('afterDelete');
export const AfterLoad = hook('afterLoad');
