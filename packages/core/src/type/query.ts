import { Properties, Relations } from './entity';
import { Scalar, Unpacked } from './utility';

export type QueryFieldFilter<E> = {
  readonly [P in Properties<E>]?: E[P] | E[P][] | QueryComparisonOperator;
};

export type QueryProject<E> =
  | readonly Properties<E>[]
  | {
      readonly [P in Properties<E>]?: boolean | 0 | 1;
    };

export type QueryPopulate<E> = {
  readonly [P in Relations<E>]?: QueryPopulateValue<E[P]>;
};

export type QueryPopulateValue<E> = Query<Unpacked<E>> & { $required?: boolean };

export type QueryTextSearchOptions<E> = {
  readonly $fields?: Properties<E>[];
  readonly $value: string;
};

export type QueryTextSearch<E> = {
  readonly $text?: QueryTextSearchOptions<E>;
};

export type QueryComparisonOperator = {
  readonly $eq?: Scalar;
  readonly $ne?: Scalar;
  readonly $lt?: number;
  readonly $lte?: number;
  readonly $gt?: number;
  readonly $gte?: number;
  readonly $startsWith?: string;
  readonly $in?: Scalar[];
  readonly $nin?: Scalar[];
  readonly $re?: string;
};

export type QueryLogicalOperatorKey = '$and' | '$or';

export type QueryLogicalOperator<E> = {
  [p in QueryLogicalOperatorKey]?: (QueryFieldFilter<E> | QueryTextSearch<E>)[];
};

export type QueryFilter<E> = QueryLogicalOperator<E> | QueryTextSearch<E> | QueryFieldFilter<E>;

export type QuerySort<E> = {
  readonly [P in Properties<E>]?: -1 | 1;
};

export type QueryPager = {
  $skip?: number;
  $limit?: number;
};

export type QueryCriteria<E> = {
  $filter?: QueryFilter<E>;
  $sort?: QuerySort<E>;
} & QueryPager;

export type Query<E> = {
  $project?: QueryProject<E>;
  $populate?: QueryPopulate<E>;
  $group?: Properties<E>[];
} & QueryCriteria<E>;

export type QueryOne<E> = Query<E> & { $limit?: 1 };

export type QueryStringified = {
  readonly [P in keyof Query<any>]?: string;
};

export type QueryUpdateResult = {
  readonly changes?: number;
  readonly lastId?: number;
};
