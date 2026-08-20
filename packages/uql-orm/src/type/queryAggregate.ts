import type { FieldKey } from './entity.js';
import type { QueryPager, QuerySortDirection } from './query.js';
import type { QueryWhere, QueryWhereFieldValue } from './queryWhere.js';

/**
 * Maps the offending keys to `never`, turning an excess key into a compile error; resolves to
 * `unknown` (an inert intersection member) when there are none. Used by `aggregate`'s `$group`,
 * which is captured as a generic (a bare generic skips excess-property checking). The find methods
 * don't need this: they take concrete `Query<E>` params, so TypeScript's native excess-property
 * checking rejects stray keys directly.
 * @internal
 */
type Reject<K> = [K] extends [never] ? unknown : Record<K & string, never>;

/**
 * The columns `$group` actually names: keys whose value is literally `true`, not `keyof G`.
 * Wherever `G` cannot be inferred - `$group` omitted, hoisted, or annotated - it *is* its own
 * constraint, whose every value is `true | undefined`, and keying off values yields `never` there
 * rather than every field of the entity.
 * @internal
 */
type GroupedKeys<G> = { [K in keyof G]: G[K] extends true ? K : never }[keyof G];

/**
 * The keys `T` declares by name, or `never` when `T` is only an index signature - which is what an
 * uninferred `$agg` is, and what would otherwise make every key look like a declared alias.
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
 * values: `$countDistinct` → `COUNT(DISTINCT col)`, and likewise `$sumDistinct`/`$avgDistinct`. Flat
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

/** The argument of an aggregate function: a field, or `'*'` (only meaningful for `COUNT(*)`). */
export type QueryAggregateArg<E> = FieldKey<E> | '*';

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
  Record<TotallingOp, NumericFieldKey<E>> &
  Record<Exclude<AggregateOp, '$count' | TotallingOp>, FieldKey<E>>;

/** Exactly one key of `T`: the chosen op with its value; every other op key is forbidden (`never`). */
type ExactlyOne<T> = {
  [K in keyof T]: Readonly<Record<K, T[K]>> & Partial<Readonly<Record<Exclude<keyof T, K>, never>>>;
}[keyof T];

/**
 * An aggregate function applied to a field. Exactly one operation per entry (a second op is a
 * compile error). Only `$count` accepts `'*'` (i.e. `COUNT(*)`); every other op requires a field.
 * DISTINCT variants are flat ops (`$countDistinct`/`$sumDistinct`/`$avgDistinct`) taking a field.
 *
 * @example { $count: '*' }            → COUNT(*)
 * @example { $countDistinct: 'id' }   → COUNT(DISTINCT "id")
 * @example { $sum: 'amount' }         → SUM("amount")
 * @example { $sumDistinct: 'amount' } → SUM(DISTINCT "amount")
 * @example { $avg: 'age' }            → AVG("age")
 */
export type QueryAggregateFn<E> = ExactlyOne<QueryAggregateArgMap<E>>;

/** A single-key `{ [op]: unknown }` shape for each op in `Ops`, matched to infer that op's result. */
type FnWithOp<Ops extends string> = { [K in Ops]: { readonly [P in K]: unknown } }[Ops];

/** Ops that count rows. Alone among the ops they answer `0`, never NULL, over an empty group. */
type CountingOp = OpsOf<'$count' | '$countDistinct'>;

/**
 * Group-by columns: an object mapping entity field keys to `true`, exactly like {@link QuerySelect}.
 * Typed against the entity, so a typo'd column is a compile error. Compute aggregate columns with
 * {@link QueryAggMap} (the `$agg` key), not here.
 *
 * @example
 * ```ts
 * { status: true } // → GROUP BY "status"
 * ```
 */
export type QueryGroupMap<E> = {
  readonly [K in FieldKey<E>]?: true;
};

/**
 * Computed aggregate columns: an object mapping your chosen output alias to an aggregate function.
 * Alias names are free (you are naming new columns); the aggregated field reference inside each
 * function is typed against the entity.
 *
 * @example
 * ```ts
 * { count: { $count: '*' }, avgAge: { $avg: 'age' } }
 * // → COUNT(*) AS "count", AVG("age") AS "avgAge"
 * ```
 */
export type QueryAggMap<E> = {
  readonly [alias: string]: QueryAggregateFn<E>;
};

/** The entity type of an aggregated field reference `F`, or `unknown` if it is not a known field. */
type FieldValueType<E, F> = F extends keyof E ? E[F] : unknown;

/**
 * Resolves a single computed column's type from its aggregate function: `$count` is always
 * `number`; `$sum`/`$avg` total to a `number` or to `null`; `$min`/`$max` keep the aggregated
 * field's own type, likewise or `null`.
 *
 * Everything but `$count` is nullable: an aggregate over zero rows is NULL, and an ungrouped one
 * still returns a row, so a `$where` matching nothing hands back a row of NULLs.
 *
 * `$sum`/`$avg` are exact to 2^53: Postgres widens a sum over BIGINT to NUMERIC, and decoding that
 * text to satisfy this `number` drops the digits past that bound. Use `raw()` for a wider total.
 * @internal
 */
type QueryAggregateFnResult<E, Fn> =
  Fn extends FnWithOp<CountingOp>
    ? number
    : Fn extends FnWithOp<TotallingOp>
      ? number | null
      : Fn extends { readonly $min: infer F } | { readonly $max: infer F }
        ? FieldValueType<E, F> | null
        : unknown;

/**
 * Flattens an intersection into a single object literal for readable editor hovers.
 * @internal
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Infers the aggregated result row: grouped columns (`G`) keep their entity type; computed columns
 * (`A`) resolve from their aggregate function via {@link QueryAggregateFnResult}.
 *
 * Grouped columns come from {@link GroupedKeys}, not `keyof G`, so a `$group` the compiler could
 * not read contributes none rather than all of them.
 */
export type QueryAggregateResult<E, G, A> = Simplify<
  { -readonly [K in GroupedKeys<G> & FieldKey<E>]: E[K] } & {
    -readonly [K in keyof A]: QueryAggregateFnResult<E, A[K]>;
  }
>;

/**
 * Erased runtime shape of a HAVING clause (alias → comparison), consumed by the dialect builders.
 * Values are `unknown` because the SQL is built generically; the typed, per-column value checking
 * lives in {@link QueryAggregate.$having}.
 *
 * @example { count: { $gt: 5 } }   → HAVING COUNT(*) > 5
 */
export type QueryHavingMap = {
  readonly [alias: string]: QueryWhereFieldValue<unknown> | undefined;
};

/**
 * Aggregate query - separate from `Query<E>` to keep return types honest.
 * Used exclusively with `querier.aggregate()`.
 *
 * @example
 * ```ts
 * querier.aggregate(User, {
 *   $where: { deletedAt: { $isNull: true } },
 *   $group: { status: true },
 *   $agg: { count: { $count: '*' }, avgAge: { $avg: 'age' } },
 *   $having: { count: { $gt: 5 } },
 *   $sort: { count: -1 },
 * });
 * ```
 */
export type QueryAggregate<
  E,
  G extends QueryGroupMap<E> = QueryGroupMap<E>,
  A extends QueryAggMap<E> = QueryAggMap<E>,
> = {
  // Fields are ordered to match how SQL and MongoDB process a query:
  // WHERE → GROUP BY → aggregates → HAVING → ORDER BY → OFFSET/LIMIT.

  /**
   * Row-level filtering, applied before grouping (SQL `WHERE`, MongoDB `$match`).
   */
  readonly $where?: QueryWhere<E>;

  /**
   * Columns to group by - `{ status: true }`, typed against the entity like `$select`. A computed
   * aggregate wrongly placed here (it belongs in `$agg`) is rejected via {@link Reject}, since
   * `$group` is captured as a generic and a bare generic skips excess-property checking.
   */
  readonly $group?: G & Reject<Exclude<keyof G, FieldKey<E>>>;

  /**
   * Computed aggregate columns - `{ count: { $count: '*' }, avgAge: { $avg: 'age' } }`.
   *
   * An alias repeating a `$group` column is rejected: both would be emitted under that one name,
   * leaving the driver to keep whichever it read last.
   */
  readonly $agg?: A & Reject<NamedKeys<A> & GroupedKeys<G>>;

  /**
   * Post-aggregation filtering, applied after grouping (SQL `HAVING`, MongoDB post-group `$match`).
   * Keyed by the result columns (grouped columns + computed aliases), and each value is typed to that
   * column's result type - a `$min`/`$max` over a `Date` field compares against a `Date`, a grouped
   * column against its own type - reusing {@link QueryAggregateResult}. A name that is neither is a
   * compile error.
   */
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
