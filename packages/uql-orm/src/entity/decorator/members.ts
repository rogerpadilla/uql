import type {
  EntityGetter,
  FieldOptions,
  FieldType,
  HookEvent,
  IdValue,
  NamedIdKey,
  RelationManyToManyOptions,
  RelationManyToOneOptions,
  RelationOneToManyOptions,
  RelationOneToOneOptions,
  RelationOptions,
  TsTypeOf,
} from '../../type/index.js';
import type { RejectIncompatible } from '../../util/index.js';
import { relationRegistration } from '../metadata/definition.js';
import { memberRegistrations } from './bag.js';

// The member decorators share one mechanism, which is why they share a file: the standard spec gives a
// member decorator no reference to its class, so each records what it was told on `context.metadata` and
// `@Entity()` drains it (see `bag.ts`). What they add on top is checking, by pinning the context's value
// type: the `type`, `entity` or referenced key a decorator declares is compared against the property it is
// written on.

/** A member decorator that also constrains the property it may be applied to, on a class `O`. */
type MemberDecorator<V, O = unknown> = (value: undefined, context: ClassFieldDecoratorContext<O, V>) => void;

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
 * The property type a set of field options describes: the declared `type`, narrowed by `enum` to the
 * values that type admits (so `enum: [2]` stays off a `String`), or else the referenced key's own type,
 * which makes `@Field({ references: () => User })` on a `number` an error when `User.id` is a `uuid`.
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
    RejectUnknown<O, FieldOptions> &
    RejectIncompatible<O>,
>(opts: O): MemberDecorator<DeclaredValue<O> | undefined> {
  return (_value, context) => {
    memberRegistrations(context.metadata).fields[String(context.name)] = opts;
  };
}

/**
 * A key the type level cannot name, reported on each `@Id` that leaves it unnamed. Where no `idKey`
 * brand and no conventional name applies, `IdKey` falls back to every field, and `IdValue`,
 * `EntityId` and every by-id method are then typed against a column that is not the key.
 */
type KeyIsNamed<This> = [NamedIdKey<This>] extends [never] ? { readonly __keyNeedsIdKeyBrand: true } : unknown;

/** {@link MemberDecorator} that also constrains the class, which is where a key is named. */
type IdDecorator<V> = <This>(value: undefined, context: ClassFieldDecoratorContext<This, V> & KeyIsNamed<This>) => void;

/**
 * Declares the primary key, checked the same way as `@Field` and additionally against the class:
 * a key not named `id`, `_id` or `uuid` has to be named by the `idKey` brand.
 *
 * @example `@Id({ type: Number }) id?: number;`
 * @example `@Id({ type: 'uuid', onInsert: uuidv7 }) id?: string;`
 * @example `[idKey]?: 'pk';` beside `@Id({ type: Number }) pk?: number;`
 */
export function Id<
  O extends FieldOptions<DeclaredValue<O>> & { type: FieldType } & RejectUnknown<O, FieldOptions> &
    RejectIncompatible<O> &
    // A key is NOT NULL in every engine, and the `isId` that says so is stamped on below rather than
    // authored, so this is the one contradiction the shared check cannot see from `O` alone.
    { readonly nullable?: false },
>(opts: O): IdDecorator<DeclaredValue<O> | undefined> {
  return (_value, context) => {
    memberRegistrations(context.metadata).fields[String(context.name)] = { ...opts, isId: true };
  };
}

/**
 * `E` comes from the mandatory `entity` getter, so the context can insist the property really holds that
 * entity: `@ManyToOne({ entity: () => Other })` on a `Company` field stops compiling, and a to-many
 * cardinality on a non-array property does too. `entity` is required because nothing reflects it now.
 * `O` is inferred from the class the decorator sits on, which types `references`' own side.
 */
type WithEntity<E, O> = O & { readonly entity: EntityGetter<E> };

function relation<E extends object, O, V>(opts: RelationOptions<E, O>): MemberDecorator<V, O> {
  return (_value, context) => {
    memberRegistrations(context.metadata).relations[String(context.name)] = relationRegistration(opts);
  };
}

export function OneToOne<E extends object, O>(
  opts: WithEntity<E, RelationOneToOneOptions<E, O>>,
): MemberDecorator<E | undefined, O> {
  return relation<E, O, E | undefined>({ cardinality: '11', ...opts });
}

export function ManyToOne<E extends object, O>(
  opts: WithEntity<E, RelationManyToOneOptions<E, O>>,
): MemberDecorator<E | undefined, O> {
  return relation<E, O, E | undefined>({ cardinality: 'm1', ...opts });
}

export function OneToMany<E extends object, O>(
  opts: WithEntity<E, RelationOneToManyOptions<E, O>>,
): MemberDecorator<readonly E[] | undefined, O> {
  return relation<E, O, readonly E[] | undefined>({ cardinality: '1m', ...opts });
}

export function ManyToMany<E extends object, O>(
  opts: WithEntity<E, RelationManyToManyOptions<E, O>>,
): MemberDecorator<readonly E[] | undefined, O> {
  return relation<E, O, readonly E[] | undefined>({ cardinality: 'mm', ...opts });
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
export const BeforeUpsert = hook('beforeUpsert');
export const AfterUpsert = hook('afterUpsert');
export const BeforeDelete = hook('beforeDelete');
export const AfterDelete = hook('afterDelete');
export const AfterLoad = hook('afterLoad');
