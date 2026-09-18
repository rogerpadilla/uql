import type { FieldKey, RelationKey, RelationTarget } from './entity.js';
import type { QueryPager, QuerySelect, QuerySortDirection } from './query.js';
import type { QueryRaw } from './queryRaw.js';
import type { QueryWhere, QueryWhereFieldValue } from './queryWhere.js';
import type { IsMany, RejectKeys } from './utility.js';

/** The columns `$group` names by a literal `true`, so an uninferred `$group`, its own constraint, names none. */
type GroupedKeys<G> = { [K in keyof G]: G[K] extends true ? K : never }[keyof G];

/**
 * The keys `T` declares by name, or `never` when `T` is only an index signature - which is what an
 * uninferred `$select` is, and what would otherwise make every key look like a declared alias.
 * @internal
 */
type NamedKeys<T> = string extends keyof T ? never : keyof T;

const QUERY_AGGREGATE_OPS = ['$count', '$sum', '$avg', '$min', '$max'] as const;

/**
 * Supported aggregate operations.
 */
export type QueryAggregateOp = (typeof QUERY_AGGREGATE_OPS)[number];

/**
 * Whether `op` is one of {@link QueryAggregateOp}'s known aggregate operators - validates operator
 * keys parsed from query data before trusting them as `QueryAggregateOp`.
 */
export function isQueryAggregateOp(op: string): op is QueryAggregateOp {
  return (QUERY_AGGREGATE_OPS as readonly string[]).includes(op);
}

/**
 * `$countDistinct` -> `COUNT(DISTINCT col)`. Flat (not a nested `{ $distinct }` argument) so the op is
 * self-documenting and greppable. The other ops have no DISTINCT variant: `$sum`/`$avg` over deduplicated
 * values is rarely what totalling or averaging means, and DISTINCT is a no-op for `$min`/`$max`.
 */
export type QueryAggregateDistinctOp = '$countDistinct';

/**
 * Resolve an aggregate op key into its base op and whether it is DISTINCT-qualified: `$countDistinct`
 * resolves to `$count` with `distinct: true`, a plain op to itself with `distinct: false`. Throws otherwise.
 */
export function resolveAggregateOp(key: string): { op: QueryAggregateOp; distinct: boolean } {
  if (key === '$countDistinct') {
    return { op: '$count', distinct: true };
  }
  if (isQueryAggregateOp(key)) {
    return { op: key, distinct: false };
  }
  throw new TypeError(`unsupported aggregate operator: ${key}`);
}

/**
 * Exactly one key of `T` with its value; every other key is forbidden (`never`). `Pick`, not `Record`,
 * so the chosen key stays linked to `T`'s own property and renames follow it through.
 */
type ExactlyOne<T> = {
  [K in keyof T]: Readonly<Pick<T, K>> & Partial<Readonly<Record<Exclude<keyof T, K>, never>>>;
}[keyof T];

/**
 * One field named as a key - `{ amount: true }` - the way a statement names every field, so an editor
 * rename reaches it where a string never would. `F` narrows which fields qualify.
 */
export type QueryFieldRef<E, F extends keyof E = FieldKey<E>> = ExactlyOne<Required<QuerySelect<E, F, true>>>;

/** The argument of an aggregate function: a field, or `'*'` (only meaningful for `COUNT(*)`). */
export type QueryAggregateArg<E> = QueryFieldRef<E> | '*';

/**
 * Fields `SUM`/`AVG` can total. Restricted to numeric columns because totalling a text or date one is
 * either an engine error or a coercion, and neither produces the value the signature promises.
 */
type NumericFieldKey<E> = {
  readonly [K in FieldKey<E>]: [NonNullable<E[K]>] extends [number | bigint] ? K : never;
}[FieldKey<E>];

/** Every aggregate op, plain and DISTINCT-qualified. */
type AggregateOp = QueryAggregateOp | QueryAggregateDistinctOp;

/**
 * Names a subset of {@link AggregateOp}. The constraint is the point, and why this is not `Extract`:
 * renaming an op stops these literals satisfying it and breaks the subsets below at compile time,
 * where `Extract` would quietly drop the renamed member and leave the subset wrong but valid.
 */
type OpsOf<K extends AggregateOp> = K;

/** Ops that add a column up, which keeps the column's own type: a `bigint` column totals to a `bigint`. */
type SummingOp = OpsOf<'$sum'>;

/** Ops that mean a column, which the engine floats, so the result is a `number` however wide the column. */
type AveragingOp = OpsOf<'$avg'>;

/** Ops that total a column, so their argument has to be numeric. */
type TotallingOp = SummingOp | AveragingOp;

/**
 * Every aggregate op mapped to the argument it accepts: `$count` a field or `'*'` (`COUNT(*)`),
 * the totalling ops a numeric field, `$min`/`$max`/`$countDistinct` any field.
 */
type QueryAggregateArgMap<E> = Record<'$count', QueryAggregateArg<E>> &
  Record<TotallingOp, QueryFieldRef<E, NumericFieldKey<E>>> &
  Record<Exclude<AggregateOp, '$count' | TotallingOp>, QueryFieldRef<E>>;

/**
 * An aggregate over one field, exactly one op per entry: `{ $sum: { amount: true } }` is `SUM("amount")`,
 * `{ $countDistinct: { id: true } }` is `COUNT(DISTINCT "id")`, and only `$count` takes `'*'`. Its own
 * `$where` narrows the rows it reads to those matching, over the entity's own fields.
 */
export type QueryAggregateFn<E> = ExactlyOne<QueryAggregateArgMap<E>> & {
  readonly $where?: QueryAggregateWhere<E>;
};

/** What an aggregate's own `$where` reads: the entity's fields, since a relation there is a subquery inside it. */
type QueryAggregateWhere<E> = QueryWhere<E, QueryRaw, FieldKey<E>>;

/** An aggregate's `$where` naming a key it does not have, refused: a captured `$select` skips the excess-property check. */
type AggregateWhereKeys<E, Fn> = Fn extends { readonly $where: infer W }
  ? { readonly $where: RejectKeys<Exclude<keyof W, keyof QueryAggregateWhere<E>>> }
  : unknown;

/** A single-key `{ [op]: Arg }` shape for each op in `Ops`, matched to infer that op's result or its argument. */
type FnWithOp<Ops extends string, Arg = unknown> = { [K in Ops]: { readonly [P in K]: Arg } }[Ops];

/** Ops that count rows. Alone among the ops they answer `0`, never NULL, over an empty group. */
type CountingOp = OpsOf<'$count' | '$countDistinct'>;

/** Ops that read back as the column they aggregate, rather than widening or floating it. */
type ColumnTypedOp = SummingOp | OpsOf<'$min' | '$max'>;

/**
 * A field a group key reads, by the path to it: `{ orderId: true }`, or through a to-one relation,
 * `{ transaction: { orderId: true } }`. A to-many is `never`, since joining one multiplies the rows.
 */
export type QueryGroupRef<E, K extends keyof E = FieldKey<E> | RelationKey<E>> = ExactlyOne<
  Required<{
    [P in K]: P extends RelationKey<E>
      ? IsMany<E[P]> extends true
        ? never
        : QueryGroupRef<RelationTarget<E[P]>>
      : true;
  }>
>;

/** The columns to group by: a field switched on, `{ status: true }`, or an alias for a field a path reads. */
export type QueryGroupMap<E> = { readonly [key: string]: true | QueryGroupRef<E> };

/**
 * A captured `$group` against its schema: a field key takes `true` and keeps its link, any other key is an
 * alias for a path. A key switched on that is no field is refused by name, which the intersection alone lets by.
 */
type QueryGroupSchema<E, G> = Readonly<QuerySelect<E, FieldKey<E>, true>> & {
  readonly [K in Exclude<NamedKeys<G>, FieldKey<E>>]: QueryGroupRef<E>;
} & RejectKeys<Exclude<GroupedKeys<G>, FieldKey<E>>>;

/**
 * The value a path reads: the field at its end as its column holds it, `null` only where that does, since
 * the path joins the rows it reads. `any` answers `unknown`: TypeScript checks a deferred type by
 * instantiating it with `any`, which would walk every relation of the entity on every aggregate call.
 */
type GroupRefValue<E, Ref> = 0 extends 1 & Ref
  ? unknown
  : {
      [K in keyof Ref & keyof E]: Ref[K] extends true
        ? Exclude<E[K], undefined>
        : GroupRefValue<RelationTarget<E[K]>, Ref[K]>;
    }[keyof Ref & keyof E];

/** Computed columns by the alias each is read back under: `{ count: { $count: '*' }, avgAge: { $avg: { age: true } } }`. */
export type QueryAggMap<E> = {
  readonly [alias: string]: QueryAggregateFn<E>;
};

/** The entity type of an aggregated field reference `F`, or `unknown` if it is not a known field. */
type FieldValueType<E, F> = F extends keyof E ? E[F] : unknown;

/**
 * A computed column's type: a count is a `number`; every other aggregate is `null` over no rows, a mean
 * a `number` whatever it read, and a total, a `$min` or a `$max` the column's own type - so a `bigint`
 * column totals to a `bigint`, which is what the driver decodes rather than rounding through a float.
 */
type QueryAggregateFnResult<E, Fn> =
  Fn extends FnWithOp<CountingOp>
    ? number
    : Fn extends FnWithOp<AveragingOp>
      ? number | null
      : Fn extends FnWithOp<ColumnTypedOp, infer F>
        ? FieldValueType<E, keyof F> | null
        : unknown;

/**
 * Flattens an intersection into a single object literal for readable editor hovers.
 * @internal
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** An aggregate's row: each grouped column with its entity type, each alias with its path's, each computed one with its aggregate's. */
export type QueryAggregateResult<E, G, A> = Simplify<
  Pick<E, GroupedKeys<G> & FieldKey<E>> & {
    -readonly [K in Exclude<NamedKeys<G>, FieldKey<E>>]: GroupRefValue<E, G[K]>;
  } & {
    -readonly [K in keyof A]: QueryAggregateFnResult<E, A[K]>;
  }
>;

/** A `HAVING` as the dialects read it, erased; {@link QueryAggregate.$having} is where it is typed. `{ count: { $gt: 5 } }` */
export type QueryHavingMap = {
  readonly [alias: string]: QueryWhereFieldValue<unknown> | undefined;
};

/**
 * An aggregate query, apart from `Query` so its row type stays honest:
 * `aggregate(User, { $group: { status: true }, $select: { n: { $count: '*' } }, $having: { n: { $gt: 5 } } })`.
 */
export type QueryAggregate<
  E,
  G extends QueryGroupMap<E> = QueryGroupMap<E>,
  A extends QueryAggMap<E> = QueryAggMap<E>,
> = {
  // Fields are ordered to match how SQL and MongoDB process a query:
  // WHERE -> GROUP BY -> aggregates -> HAVING -> ORDER BY -> OFFSET/LIMIT.

  /**
   * Row-level filtering, applied before grouping (SQL `WHERE`, MongoDB `$match`).
   */
  readonly $where?: QueryWhere<E>;

  /**
   * Columns to group by: `{ status: true }`, or an alias for a to-one relation's field by the path to
   * it, `{ orderId: { transaction: { orderId: true } } }`. The captured map meets its schema, so a field
   * key keeps its link to the entity property, and a typo matches neither form.
   */
  readonly $group?: G & QueryGroupSchema<E, G>;

  /**
   * The computed columns by alias, the captured map meeting its schema so field keys stay linked. An alias
   * repeating a `$group` column is refused, since both would come back under one name.
   */
  readonly $select?: A & {
    readonly [K in keyof A]: QueryAggregateFn<E> & AggregateWhereKeys<E, A[K]>;
  } & RejectKeys<NamedKeys<A> & NamedKeys<G>>;

  /** Filtering after grouping, by a result column, each value typed as that column is. */
  readonly $having?: {
    readonly [K in keyof QueryAggregateResult<E, G, A>]?: QueryWhereFieldValue<QueryAggregateResult<E, G, A>[K]>;
  };

  /**
   * Sort the aggregated results by a grouped column or a computed alias - an aggregate's rows are
   * its groups, so any other entity field names a value the statement never produced.
   */
  readonly $sort?: {
    readonly [K in keyof QueryAggregateResult<E, G, A>]?: QuerySortDirection;
  };
} & QueryPager;
