import type {
  DefineEntityOptions,
  DefinedClass,
  DefinedFields,
  RelationBuilder,
  RelationRow,
} from './definedEntity.js';
import type { FilterSection, idKey, IsUnion, NamedIdKey, readOnly } from './entity.js';
import type { PolicySection } from './policy.js';
import type { Captured, Query, QueryFindResult, QueryPager, QuerySelect, Wire } from './query.js';
import type { QueryAggregate, QueryAggregateResult } from './queryAggregate.js';
import type { Except, Type } from './utility.js';

/** What orders and pages rows: a read's, since a view is a set of rows. */
type Paging = keyof QueryPager | keyof Pick<Query<object>, '$sort' | '$candidates'>;

/**
 * The find a view takes: a `Query` with its typed `$select`, less paging and what a flat row of columns cannot hold:
 * `$populate` and `$count` would nest into it, `$select`'s SQL list types none, and `$lock` belongs to a read.
 */
export type ViewFind<S> = Except<Query<S>, Paging | '$populate' | '$count' | '$lock'> & {
  readonly $select?: QuerySelect<S>;
};

/** The aggregate a view takes: what `pool.aggregate` takes, less paging. */
export type ViewAggregate<S, Q = never> = Except<QueryAggregate<S, Q>, Paging & keyof QueryAggregate<S, Q>>;

/** What every view states beside its query, named as an entity is. See architecture/views.md. */
export type ViewOptions = Pick<DefineEntityOptions<DefinedFields>, 'name' | 'table' | 'schema'> & {
  /** What a client may do over an API: read it, or nothing. */
  readonly wire?: Wire<'read'>;
};

/** A view over an aggregate of `from`, as `pool.aggregate` takes it. */
export type AggregateViewOptions<S, Q> = ViewOptions & {
  readonly from: () => Type<S>;
  readonly aggregate: Captured<ViewAggregate<S, Q>, Q>;
  readonly find?: never;
};

/** A view over a find of `from`: a filtered projection. */
export type FindViewOptions<S, Q> = ViewOptions & {
  readonly from: () => Type<S>;
  readonly find: Captured<ViewFind<S>, Q>;
  readonly aggregate?: never;
};

/** A view's row: what its query answers, branded read-only and keyed by `K`. */
export type ViewRow<R, K> = R & ViewBrands<K>;

/** A view's brands, named so a consumer's emitted declarations refer to them rather than to the symbols. */
export type ViewBrands<K> = { readonly [readOnly]?: true; readonly [idKey]?: K };

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

type View<R, K> = DefinedView<ViewRow<R, K>, KeyValue<R, K>, R>;

export type AggregateView<S, Q> = View<QueryAggregateResult<S, Q>, GroupKey<QueryAggregateResult<S, Q>, Q>>;

export type FindView<S, Q> = View<QueryFindResult<S, Q>, FindKey<S, QueryFindResult<S, Q>>>;

/** The sections a view takes: no computed fields, checks, triggers or hooks, since nothing writes it. */
export const VIEW_SECTIONS = ['filters', 'policies', 'relations'] as const;

type ViewSection = (typeof VIEW_SECTIONS)[number];

/** A view's class while its sections may still be declared, each once. */
export type DefinedView<Row, Key, Columns, Left extends ViewSection = ViewSection> = DefinedClass<Row, Key, Columns> &
  Pick<
    {
      filters(filters: FilterSection<Row>): DefinedView<Row, Key, Columns, Exclude<Left, 'filters'>>;
      policies(policies: PolicySection<Row>): DefinedView<Row, Key, Columns, Exclude<Left, 'policies'>>;
      relations<const R>(
        relations: (rel: RelationBuilder<Columns>) => R,
      ): DefinedView<Row & RelationRow<R>, Key, Columns, Exclude<Left, 'relations'>>;
    },
    Left
  >;
