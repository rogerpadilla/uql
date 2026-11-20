import type {
  DefineEntityOptions,
  DefinedClass,
  DefinedFields,
  RelationBuilder,
  RelationRow,
} from './definedEntity.js';
import type { FilterSection, idKey, IndexSection, IsUnion, NamedIdKey, readOnly } from './entity.js';
import type { PolicySection } from './policy.js';
import type { Captured, Query, QueryFindResult, QueryPager, QuerySelect, QuerySortMap, Wire } from './query.js';
import type { QueryAggregate, QueryAggregateResult } from './queryAggregate.js';
import type { Except, Type } from './utility.js';

/** What orders and pages rows: a read's, since a view is a set of rows, but for a top N. */
type Paging = keyof QueryPager | keyof Pick<Query<object>, '$sort' | '$candidates'>;

/**
 * A view's order and page: none, or a top N, `$sort` taken with `$limit` alone, since a sort alone orders nothing in
 * a set of rows and a limit alone takes rows in no order.
 */
type TopRows<Sort> =
  | { readonly $sort?: undefined; readonly $limit?: undefined; readonly $skip?: undefined }
  | { readonly $sort: Sort; readonly $limit: number; readonly $skip?: number };

/**
 * The find a view takes: a `Query` with its typed `$select`, its paging a top N, less what a flat row of columns
 * cannot hold: `$populate` and `$count` would nest into it, `$select`'s SQL list types none, and `$lock` belongs to a read.
 */
export type ViewFind<S> = Except<Query<S>, Paging | '$populate' | '$count' | '$lock'> & {
  readonly $select?: QuerySelect<S>;
} & TopRows<QuerySortMap<S>>;

/** The aggregate a view takes: what `pool.aggregate` takes, its paging a top N. */
export type ViewAggregate<S, Q = never> = Except<QueryAggregate<S, Q>, Paging & keyof QueryAggregate<S, Q>> &
  TopRows<QueryAggregate<S, Q>['$sort']>;

/** What every view states beside its query, named as an entity is. See architecture/views.md. */
export type ViewOptions<M extends boolean = boolean> = Pick<
  DefineEntityOptions<DefinedFields>,
  'name' | 'table' | 'schema'
> & {
  /** What a client may do over an API: read it, or nothing. */
  readonly wire?: Wire<'read'>;
  /** Kept as a table `refreshView` brings to its query's rows, where a plain view is read by its query. */
  readonly materialized?: M;
};

/** A view over an aggregate of `from`, as `pool.aggregate` takes it. */
export type AggregateViewOptions<S, Q, M extends boolean = false> = ViewOptions<M> & {
  readonly from: () => Type<S>;
  readonly aggregate: Captured<ViewAggregate<S, Q>, Q>;
  readonly find?: never;
};

/** A view over a find of `from`: a filtered projection. */
export type FindViewOptions<S, Q, M extends boolean = false> = ViewOptions<M> & {
  readonly from: () => Type<S>;
  readonly find: Captured<ViewFind<S>, Q>;
  readonly aggregate?: never;
};

/** A view's row: what its query answers, branded read-only, refreshed where materialized, and keyed by `K`. */
export type ViewRow<R, K, M = false> = R & ViewBrands<K, M>;

/** A view's brands, named so a consumer's emitted declarations refer to them rather than to the symbols. */
export type ViewBrands<K, M = false> = {
  readonly [readOnly]?: M extends true ? 'refreshed' : true;
  readonly [idKey]?: K;
};

/** The key's value, as a relation onto the view reads it: `never` where it has none or spans several columns. */
type KeyValue<R, K> = [K] extends [never] ? never : true extends IsUnion<K> ? never : R[K & keyof R];

/** An aggregate's key: its groups, where none can be NULL, since NULL groups are not unique. */
type GroupKey<R, Q> = Q extends { readonly $group?: infer G }
  ? [{ [K in keyof G & keyof R]: null extends R[K] ? K : never }[keyof G & keyof R]] extends [never]
    ? keyof G & keyof R
    : never
  : never;

/** A find's key: its source's, where it selects every column of it. */
type FindKey<S, R> = [Exclude<NamedIdKey<S>, keyof R>] extends [never] ? NamedIdKey<S> : never;

type View<R, K, M> = DefinedView<ViewRow<R, K, M>, KeyValue<R, K>, R, M extends true ? ViewSection : PlainSection>;

export type AggregateView<S, Q, M = false> = View<
  QueryAggregateResult<S, Q>,
  GroupKey<QueryAggregateResult<S, Q>, Q>,
  M
>;

export type FindView<S, Q, M = false> = View<QueryFindResult<S, Q>, FindKey<S, QueryFindResult<S, Q>>, M>;

/** The sections a view takes: no computed fields, checks, triggers or hooks, since nothing writes it. */
export const PLAIN_VIEW_SECTIONS = ['filters', 'policies', 'relations'] as const;
export const VIEW_SECTIONS = ['indexes', ...PLAIN_VIEW_SECTIONS] as const;

/** A plain view's: no indexes, having no rows of its own. */

type ViewSection = (typeof VIEW_SECTIONS)[number];

type PlainSection = (typeof PLAIN_VIEW_SECTIONS)[number];

/** A view's class while its sections may still be declared, each once. */
export type DefinedView<Row, Key, Columns, Left extends ViewSection = ViewSection> = DefinedClass<Row, Key, Columns> &
  Pick<
    {
      /** A materialized view's indexes, over its own rows. */
      indexes(indexes: IndexSection<Columns>): DefinedView<Row, Key, Columns, Exclude<Left, 'indexes'>>;
      filters(filters: FilterSection<Row>): DefinedView<Row, Key, Columns, Exclude<Left, 'filters'>>;
      policies(policies: PolicySection<Row>): DefinedView<Row, Key, Columns, Exclude<Left, 'policies'>>;
      relations<const R>(
        relations: (rel: RelationBuilder<Columns>) => R,
      ): DefinedView<Row & RelationRow<R>, Key, Columns, Exclude<Left, 'relations'>>;
    },
    Left
  >;
