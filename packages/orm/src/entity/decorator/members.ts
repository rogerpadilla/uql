import type {
  AggregateValue,
  ComputedRefs,
  EntityAggregate,
  EntityGetter,
  Except,
  FieldOptions,
  FieldType,
  HasCompositeKey,
  HookEvent,
  IdValue,
  NamedIdKey,
  RejectKeys,
  RelationManyToManyOptions,
  RelationManyToOneOptions,
  RelationOneToManyOptions,
  RelationOneToOneOptions,
  RelationAggregate,
  RelationOptions,
  TsTypeOf,
} from '../../type/index.js';
import type { RejectIncompatible } from '../../util/index.js';
import { relationRegistration } from '../metadata/definition.js';
import { memberRegistrations } from './bag.js';

// The member decorators get no class under the standard spec, so each records on `context.metadata`
// for `@Entity()` to drain (see `bag.ts`), and checks what it declares against the property's type.

/** A member decorator that also constrains the property it may be applied to, on a class `O`. */
type MemberDecorator<V, O = unknown> = (value: undefined, context: ClassFieldDecoratorContext<O, V>) => void;

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
    ? HasCompositeKey<E> extends true
      ? { readonly __compositeKeyNeedsAColumnPerKey: true }
      : IdValue<E>
    : never;

/** The enum's members, or a named complaint where they widened for lack of `as const`, which would check nothing. */
type EnumValue<Members, Declared> = Declared extends Members ? { readonly __enumNeedsAsConst: true } : Members;

/**
 * Declares a persisted field, its `type` checked against the property's.
 * @example `@Field({ type: String }) name?: string;`
 * @example `@Field({ references: () => User }) userId?: string;`
 */
export function Field<
  This,
  O extends FieldOptions<DeclaredValue<O>, This> &
    ({ type: FieldType } | { references: EntityGetter }) &
    RejectKeys<Exclude<keyof O, keyof FieldOptions>> &
    RejectIncompatible<O>,
>(opts: O): MemberDecorator<DeclaredValue<O> | undefined, This>;

/**
 * Declares a field a relation aggregate computes, `@Field({ computed: (user) => user.resources.count() })`.
 * The aggregate says what the field holds, so it takes no `type`, and only `count` and `sum` - the two a
 * row change turns into a delta - may be `stored`.
 * @example `@Field({ computed: (user) => user.resources.count() }) readonly resourceCount?: number;`
 */
export function Field<This, O extends AggregateOptions<This> & RejectKeys<Exclude<keyof O, keyof FieldOptions>>>(
  opts: O,
): AggregateDecorator<AggregateValue<O>, This>;

export function Field(opts: FieldOptions<never, unknown>): MemberDecorator<unknown, unknown> {
  return (_value, context) => {
    memberRegistrations(context.metadata).fields[String(context.name)] = opts;
  };
}

/**
 * A field the aggregate itself types: `stored: true` only where a trigger could keep it, and every other
 * option as a column takes it.
 */
type AggregateOptions<E> =
  | (Except<FieldOptions<never, E>, 'computed' | 'stored' | 'type'> & {
      readonly computed: EntityAggregate<E>;
      readonly stored?: false;
    })
  | (Except<FieldOptions<never, E>, 'computed' | 'stored' | 'type'> & {
      readonly computed: { agg(refs: ComputedRefs<E>): RelationAggregate<unknown, true> }['agg'];
      readonly stored: true;
    });

/**
 * {@link MemberDecorator} for a field an aggregate types, which the property has to hold *exactly*: a
 * decorator context takes a property narrower than its value, so nothing else would stop a `number`
 * from holding what `max()` reads, which is `number | null` on a parent with no rows.
 */
type AggregateDecorator<V, O> = <P extends V | undefined>(
  value: undefined,
  context: ClassFieldDecoratorContext<O, P> & ([V] extends [P] ? unknown : { readonly __propertyMustAdmit: V }),
) => void;

/**
 * A key the type level cannot name, reported on each `@Id` that leaves it unnamed. Where no `idKey`
 * brand and no conventional name applies, `IdKey` falls back to every field, and `IdValue`,
 * `EntityId` and every by-id method are then typed against a column that is not the key.
 */
type KeyIsNamed<This> = [NamedIdKey<This>] extends [never] ? { readonly __keyNeedsIdKeyBrand: true } : unknown;

/** {@link MemberDecorator} that also constrains the class, which is where a key is named. */
type IdDecorator<V> = <This>(value: undefined, context: ClassFieldDecoratorContext<This, V> & KeyIsNamed<This>) => void;

/**
 * Declares the primary key, checked like `@Field`; a key not named `id`, `_id` or `uuid` needs the `idKey` brand.
 * @example `@Id({ type: 'uuid', onInsert: uuidv7 }) id?: string;`
 */
export function Id<
  O extends FieldOptions<DeclaredValue<O>> & { type: FieldType } & RejectKeys<Exclude<keyof O, keyof FieldOptions>> &
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
