import type { FieldKey } from './entity.js';
import type { QueryPager, QuerySelect, QuerySortDirection } from './query.js';
import type { QueryWhere, QueryWhereFieldValue } from './queryWhere.js';
import type { RejectKeys } from './utility.js';

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
 * DISTINCT-qualified aggregate ops, each mapped to the base op it applies to a field's distinct
 * values: `$countDistinct` -> `COUNT(DISTINCT col)`, and likewise `$sumDistinct`/`$avgDistinct`. Flat
 * (not a nested `{ $distinct }` argument) so the op is self-documenting and greppable. `$min`/`$max`
 * are omitted: DISTINCT is a no-op for them.
 */
const QUERY_AGGREGATE_DISTINCT_OP_BASE = {
  $countDistinct: '$count',
  $sumDistinct: '$sum',
  $avgDistinct: '$avg',
} as const satisfies Readonly<Record<string, QueryAggregateOp>>;

/** DISTINCT-qualified aggregate operators (the keys of {@link QUERY_AGGREGATE_DISTINCT_OP_BASE}). */
export type QueryAggregateDistinctOp = keyof typeof QUERY_AGGREGATE_DISTINCT_OP_BASE;

/** Whether `key` is a DISTINCT-qualified aggregate operator (narrows for a cast-free base lookup). */
function isQueryAggregateDistinctOp(key: string): key is QueryAggregateDistinctOp {
  // `Object.hasOwn`, not `key in`: the latter matches inherited members like `toString`.
  return Object.hasOwn(QUERY_AGGREGATE_DISTINCT_OP_BASE, key);
}

/**
 * Resolve an aggregate op key into its base op and whether it is DISTINCT-qualified. A flat distinct
 * op resolves to its base op with `distinct: true`; a plain op to `distinct: false`. Throws otherwise
 * (`$min`/`$max` have no distinct variant).
 */
export function resolveAggregateOp(key: string): { op: QueryAggregateOp; distinct: boolean } {
  if (isQueryAggregateDistinctOp(key)) {
    return { op: QUERY_AGGREGATE_DISTINCT_OP_BASE[key], distinct: true };
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
 * Fields `SUM`/`AVG` can total. Restricted to numeric columns because the result is declared
 * `number`: totalling a text or date column is either an engine error or a coercion, and neither
 * produces the value the signature promises.
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

/** Ops that total a column, so their argument has to be numeric. */
type TotallingOp = OpsOf<'$sum' | '$avg' | '$sumDistinct' | '$avgDistinct'>;

/**
 * Every aggregate op mapped to the argument it accepts: `$count` a field or `'*'` (`COUNT(*)`),
 * the totalling ops a numeric field, `$min`/`$max`/`$countDistinct` any field.
 */
type QueryAggregateArgMap<E> = Record<'$count', QueryAggregateArg<E>> &
  Record<TotallingOp, QueryFieldRef<E, NumericFieldKey<E>>> &
  Record<Exclude<AggregateOp, '$count' | TotallingOp>, QueryFieldRef<E>>;

/**
 * An aggregate over one field, exactly one op per entry: `{ $sum: { amount: true } }` is `SUM("amount")`,
 * `{ $countDistinct: { id: true } }` is `COUNT(DISTINCT "id")`, and only `$count` takes `'*'`.
 */
export type QueryAggregateFn<E> = ExactlyOne<QueryAggregateArgMap<E>>;

/** A single-key `{ [op]: unknown }` shape for each op in `Ops`, matched to infer that op's result. */
type FnWithOp<Ops extends string> = { [K in Ops]: { readonly [P in K]: unknown } }[Ops];

/** Ops that count rows. Alone among the ops they answer `0`, never NULL, over an empty group. */
type CountingOp = OpsOf<'$count' | '$countDistinct'>;

/** The columns to group by, `{ status: true }`, typed against the entity like `$select`. */
export type QueryGroupMap<E> = Readonly<QuerySelect<E, FieldKey<E>, true>>;

/** Computed columns by the alias each is read back under: `{ count: { $count: '*' }, avgAge: { $avg: { age: true } } }`. */
export type QueryAggMap<E> = {
  readonly [alias: string]: QueryAggregateFn<E>;
};

/** The entity type of an aggregated field reference `F`, or `unknown` if it is not a known field. */
type FieldValueType<E, F> = F extends keyof E ? E[F] : unknown;

/**
 * A computed column's type: a count is a `number`; every other aggregate is `null` over no rows, a
 * total a `number` (exact to 2^53, `raw` beyond) and `$min`/`$max` the field's own type.
 */
type QueryAggregateFnResult<E, Fn> =
  Fn extends FnWithOp<CountingOp>
    ? number
    : Fn extends FnWithOp<TotallingOp>
      ? number | null
      : Fn extends { readonly $min: infer F } | { readonly $max: infer F }
        ? FieldValueType<E, keyof F> | null
        : unknown;

/**
 * Flattens an intersection into a single object literal for readable editor hovers.
 * @internal
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** An aggregate's row: each grouped column with its entity type, each computed one with its aggregate's. */
export type QueryAggregateResult<E, G, A> = Simplify<
  Pick<E, GroupedKeys<G> & FieldKey<E>> & {
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
   * Columns to group by - `{ status: true }`, typed against the entity like `$select`. A computed
   * aggregate wrongly placed here (it belongs in `$select`) is rejected via {@link RejectKeys}, since
   * `$group` is captured as a generic and a bare generic skips excess-property checking. The captured
   * map meets its schema, {@link QueryGroupMap}, so each key keeps its link to the entity property.
   */
  readonly $group?: G & QueryGroupMap<E> & RejectKeys<Exclude<keyof G, FieldKey<E>>>;

  /**
   * The computed columns by alias, the captured map meeting its schema so field keys stay linked. An alias
   * repeating a `$group` column is refused, since both would come back under one name.
   */
  readonly $select?: A & { readonly [K in keyof A]: QueryAggregateFn<E> } & RejectKeys<NamedKeys<A> & GroupedKeys<G>>;

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
