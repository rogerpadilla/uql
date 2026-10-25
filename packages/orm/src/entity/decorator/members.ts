import {
  type Column,
  COLUMN_OPTIONS,
  type ComputedRefs,
  type EntityGetter,
  type FilledOptions,
  type filledKey,
  type HookContext,
  type HookEvent,
  type IsEqual,
  type Json,
  type JsonBrand,
  type NamedIdKey,
  type NullOf,
  type QuerySql,
  RelationAggregate,
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
type AdmittingDecorator<V, M, O, Filled = true, Key = false, Lock = false> = <
  P extends V | undefined,
  N extends PropertyKey,
>(
  value: undefined,
  context: ClassFieldDecoratorContext<O, P> & { readonly name: N } & ([M] extends [P]
      ? unknown
      : { readonly __propertyMustAdmit: M }) &
    FilledIfBranded<O, N, Filled> &
    ([Key] extends [true] ? KeyIsNamed<O> : unknown) &
    ([Lock] extends [true] ? VersionIsBranded<O> : unknown),
) => void;

/** A field the `filledKey` brand lets an insert leave out, which only a default can then fill. */
type FilledIfBranded<O, N, Filled> = [Filled] extends [true]
  ? unknown
  : typeof filledKey extends keyof O
    ? N extends O[typeof filledKey]
      ? { readonly __filledKeyNeedsADefault: true }
      : unknown
    : unknown;

/**
 * Declares a persisted field, the property checked against the column: `@Field(f.string()) name!: string;`, and
 * `@Field(f.string().nullable()) bio?: string | null;` for a column holding `null`. A key is `f.number().id()`.
 * @example `@Field(f.references(() => User).nullable()) userId?: number | null;`
 */
export function Field<This, O, V>(
  column: Column<O, V>,
): AdmittingDecorator<
  Narrowable<V> | NullOf<O>,
  NullOf<O>,
  This,
  O extends FilledOptions ? true : false,
  IsKey<O>,
  O extends { readonly version: true } ? true : false
> {
  return (_value, context) => {
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

/** A JSON column with no shape holds any document, which the property narrows: `Json<Settings>`. */
type Narrowable<V> = IsEqual<V, Json> extends true ? JsonBrand | readonly JsonBrand[] : V;

/** Whether the column is a key, which the class has to name. */
type IsKey<O> = O extends { readonly isId: true } ? true : false;

/**
 * A key the type level cannot name, reported on each key column that leaves it unnamed. Where no `idKey`
 * brand and no conventional name applies, `IdKey` falls back to every field, and `IdValue`,
 * `EntityId` and every by-id method are then typed against a column that is not the key.
 */
type KeyIsNamed<This> = [NamedIdKey<This>] extends [never] ? { readonly __keyNeedsIdKeyBrand: true } : unknown;

/**
 * An optimistic lock the type level cannot see. `version: true` is what makes the column a lock at run
 * time; the `versionKey` brand is what makes an update payload require it, and a lock only half
 * declared would be a guarantee nothing enforces, so the decorator asks for both.
 */
type VersionIsBranded<This> = [VersionKey<This>] extends [never]
  ? { readonly __versionNeedsVersionKeyBrand: true }
  : unknown;

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
