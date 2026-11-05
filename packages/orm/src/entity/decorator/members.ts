import {
  type Column,
  COLUMN_OPTIONS,
  type ComputedRefs,
  type EntityGetter,
  type FilledOptions,
  type filledKey,
  type HookContext,
  type HoldsKind,
  type HookEvent,
  type IsEqual,
  type Json,
  type JsonBrand,
  type NamedIdKey,
  type NullOf,
  type QuerySql,
  type ReferencedKey,
  RelationAggregate,
  type RelationCardinality,
  type RelationManyToManyOptions,
  type RelationManyToOneOptions,
  type RelationOneToManyOptions,
  type RelationOneToOneOptions,
  type RelationOptions,
  type VersionKey,
} from '../../type/index.js';
import { aggregateField } from '../../util/field.util.js';
import { memberRefs } from '../../util/sql.js';
import { relationRegistration } from '../metadata/definition.js';
import { memberRegistrations } from './bag.js';

// The member decorators get no class under the standard spec, so each records on `context.metadata`
// for `@Entity()` to drain (see `bag.ts`), and checks what it declares against the property's type.

/** A member decorator that also constrains the property it may be applied to, on a class `O`. */
type MemberDecorator<V, O = unknown> = (value: undefined, context: ClassFieldDecoratorContext<O, V>) => void;

/**
 * A {@link MemberDecorator} whose property has to admit `M` as well as hold `V`. A decorator context is
 * covariant in its value, so on its own it takes a property narrower than the field reads: a `string`
 * where a nullable column reads `string | null`, a `number` where `max()` reads `number | null`.
 *
 * `M` is what each arm insists on rather than the whole of `V`, because a column type that names a
 * family - `jsonb`, whose document the property shapes, or `numeric`, either number kind - is meant to
 * be narrowed. A column insists on its `null`; an aggregate, whose value is exact, insists on all of it.
 */
type AdmittingDecorator<V, M, O> = <P extends V | undefined, N extends PropertyKey>(
  value: undefined,
  context: MemberContext<O, P, N, M, true, false, false>,
) => void;

/** What {@link AdmittingDecorator} asks of a property, a column's own value aside. */
type MemberContext<O, P, N, M, Filled, Key, Lock> = ClassFieldDecoratorContext<O, P> & { readonly name: N } & ([
    M,
  ] extends [P]
    ? unknown
    : { readonly __propertyMustAdmit: M }) &
  FilledIfBranded<O, N, Filled> &
  ([Key] extends [false] ? unknown : KeyIsNamed<O>) &
  ([Lock] extends [true] ? VersionIsBranded<O> : unknown);

/** An {@link AdmittingDecorator} for a column: its class is the decorator's own, and `K` is the key it references, `never` if none. */
type ColumnDecorator<V, M, Filled, Key, Lock, K = never> = <This, P extends V | undefined, N extends PropertyKey>(
  value: undefined,
  context: MemberContext<This, P, N, M, Filled, Key, Lock> & PropertyHoldsKey<P, K>,
) => void;

/**
 * A {@link ColumnDecorator} for a key nothing fills, its own signature so no other property pays for its check.
 * `P extends V` refuses the `undefined` an insert could pass, wherever `strictNullChecks` tells it apart.
 */
type SuppliedKeyDecorator<V, K> = <This, P extends V, N extends PropertyKey>(
  value: undefined,
  context: MemberContext<This, P, N, never, false, true, false> & PropertyHoldsKey<P, K> & KeyIsRequired<This, N>,
) => void;

/** Refuses a property that does not hold the key a column references: a builder cannot say, a property brands what it does not. */
type PropertyHoldsKey<P, K> = [K] extends [never]
  ? unknown
  : HoldsKind<P, K> extends true
    ? unknown
    : { readonly __propertyMustHoldReferencedKey: K };

/** The key a typed column references, `never` otherwise: `f.references` has no type of its own, its value being the key. */
type ReferencedKeyOf<O> = O extends { readonly type: unknown; readonly references: () => infer C }
  ? NonNullable<ReferencedKey<C>>
  : never;

/** A field the `filledKey` brand lets an insert leave out, which only a default can then fill. */
type FilledIfBranded<O, N, Filled> = [Filled] extends [true]
  ? unknown
  : typeof filledKey extends keyof O
    ? N extends O[typeof filledKey]
      ? { readonly __filledKeyNeedsADefault: true }
      : unknown
    : unknown;

/** What `Field` answers: a column's own checks, and that a property holds the key its column references. */
type FieldDecorator<O, V> =
  IsKey<O, V> extends 'supplied'
    ? SuppliedKeyDecorator<V, ReferencedKeyOf<O>>
    : ColumnDecorator<
        Narrowable<V> | NullOf<O>,
        NullOf<O>,
        O extends FilledOptions ? true : false,
        IsKey<O, V>,
        O extends { readonly version: true } ? true : false,
        ReferencedKeyOf<O>
      >;

/**
 * Declares a persisted field, the property checked against the column: `@Field(f.string()) name!: string;`, and
 * `@Field(f.string().nullable()) bio?: string | null;` for a column holding `null`. A key is `f.number().autoIncrement()`.
 * @example `@Field(f.references(() => User).nullable()) userId?: number | null;`
 */
export function Field<O, V>(column: Column<O, V>): FieldDecorator<O, V>;
export function Field(column: Column) {
  return (_value: undefined, context: ClassFieldDecoratorContext) => {
    memberRegistrations(context.metadata).fields[String(context.name)] = column[COLUMN_OPTIONS];
  };
}

/**
 * Declares a field the database computes, read off the entity's refs: SQL as a column,
 * `@Computed((user) => f.string().as(sql`upper(${user.name})`)) readonly shout?: string;`, or a relation
 * aggregate, `@Computed((user) => user.posts.count()) readonly postCount?: number;`, which types itself.
 */
export function Computed<This, C extends ComputedColumn | RelationAggregate>(
  expression: (refs: ComputedRefs<This>) => C,
): AdmittingDecorator<ComputedValue<C>, ComputedAdmits<C>, This> {
  return (_value, context) => {
    const computed: ComputedColumn | RelationAggregate = expression(memberRefs<This>());
    memberRegistrations(context.metadata).fields[String(context.name)] =
      computed instanceof RelationAggregate ? aggregateField(computed) : computed[COLUMN_OPTIONS];
  };
}

/** A column the database computes, what `as()` returns. */
type ComputedColumn = Column<{ readonly computed: QuerySql }>;

/** What a computed field holds: an aggregate's exact value, or a column's, `null` where it said so. */
type ComputedValue<C> =
  C extends RelationAggregate<infer V> ? V : C extends Column<infer O, infer V> ? V | NullOf<O> : never;

/** What the property has to admit: all of an aggregate's value, which is exact, and a column's `null`. */
type ComputedAdmits<C> = C extends RelationAggregate<infer V> ? V : C extends Column<infer O> ? NullOf<O> : never;

/** A JSON column with no schema holds any document, which the property narrows: `Json<Settings>`. */
type Narrowable<V> = IsEqual<V, Json> extends true ? JsonBrand | readonly JsonBrand[] : V;

/**
 * Whether the column is a key, which the class has to name, and `'supplied'` where no engine fills it: a text key is
 * one MongoDB fills, which an entity cannot rule out.
 */
type IsKey<O, V> = O extends { readonly isId: true }
  ? O extends FilledOptions
    ? true
    : O extends { readonly references: unknown }
      ? 'supplied'
      : [V] extends [number | bigint]
        ? 'supplied'
        : true
  : false;

/**
 * A key the type level cannot name, reported on each key column that leaves it unnamed. Where no `idKey`
 * brand and no conventional name applies, `IdKey` falls back to every field, and `IdValue`,
 * `EntityId` and every by-id method are then typed against a column that is not the key.
 */
type KeyIsNamed<This> = [NamedIdKey<This>] extends [never] ? { readonly __keyNeedsIdKeyBrand: true } : unknown;

/** A key nothing fills cannot be `?`, which would let an insert leave it out: read off the key, as its type cannot tell without `strictNullChecks`. */
type KeyIsRequired<O, N> = N extends keyof O
  ? {} extends Pick<O, N>
    ? { readonly __keyNothingFillsMustBeRequired: true }
    : unknown
  : unknown;

/**
 * An optimistic lock the type level cannot see. `version: true` is what makes the column a lock at run
 * time; the `versionKey` brand is what makes an update payload require it, and a lock only half
 * declared would be a guarantee nothing enforces, so the decorator asks for both.
 */
type VersionIsBranded<This> = [VersionKey<This>] extends [never]
  ? { readonly __versionNeedsVersionKeyBrand: true }
  : unknown;

/**
 * `E` comes from the target getter, so the context can insist the property really holds that entity:
 * `@ManyToOne(() => Other)` on a `Company` field stops compiling, and a to-many cardinality on a non-array
 * property does too. `O` is inferred from the class the decorator sits on, which types `references`' own side.
 */
function relation<E extends object, O, V>(
  cardinality: RelationCardinality,
  entity: EntityGetter<E>,
  opts?: Omit<RelationOptions<E, O>, 'cardinality' | 'entity'>,
): MemberDecorator<V, O> {
  return (_value, context) => {
    memberRegistrations(context.metadata).relations[String(context.name)] = relationRegistration({
      cardinality,
      entity,
      ...opts,
    });
  };
}

export function OneToOne<E extends object, O>(
  entity: EntityGetter<E>,
  opts: RelationOneToOneOptions<E, O>,
): MemberDecorator<E | undefined, O> {
  return relation<E, O, E | undefined>('11', entity, opts);
}

export function ManyToOne<E extends object, O>(
  entity: EntityGetter<E>,
  opts?: RelationManyToOneOptions<E, O>,
): MemberDecorator<E | undefined, O> {
  return relation<E, O, E | undefined>('m1', entity, opts);
}

export function OneToMany<E extends object, O>(
  entity: EntityGetter<E>,
  opts?: RelationOneToManyOptions<E, O>,
): MemberDecorator<readonly E[] | undefined, O> {
  return relation<E, O, readonly E[] | undefined>('1m', entity, opts);
}

export function ManyToMany<E extends object, O>(
  entity: EntityGetter<E>,
  opts: RelationManyToManyOptions<E, O>,
): MemberDecorator<readonly E[] | undefined, O> {
  return relation<E, O, readonly E[] | undefined>('mm', entity, opts);
}

/** What a hook method is called with: the row as `this`, and the querier's context. */
type HookMethod<This> = (this: This, ctx: HookContext) => unknown;

function hook(event: HookEvent) {
  return () =>
    // Generic in `This` so a hook declared with an explicit `this` parameter still matches; the default
    // on `ClassMethodDecoratorContext` pins `this` to `unknown` and would reject it.
    <This>(_value: HookMethod<This>, context: ClassMethodDecoratorContext<This>): void => {
      const { hooks } = memberRegistrations(context.metadata);
      hooks[event] ??= [];
      hooks[event].push({ methodName: String(context.name) });
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
