import { Fields, Relations } from './entity';
import { Unpacked } from './utility';

export type QueryRaw = {
  readonly value: string;
  readonly alias?: string;
};

export type QueryProject<E> = readonly (Fields<E> | QueryRaw)[] | QueryProjectFields<E>;

export type QueryProjectFields<E> = {
  readonly [P in Fields<E>]?: boolean | 0 | 1;
};

export type QueryPopulate<E> = {
  readonly [P in Relations<E>]?: QueryPopulateValue<E[P]>;
};

export type QueryPopulateValue<E> = Query<Unpacked<E>> & { $required?: boolean };

export type QueryTextSearchOptions<E> = {
  readonly $value: string;
  readonly $fields?: Fields<E>[];
};

export type QueryComparison<E> = {
  readonly $text?: QueryTextSearchOptions<E>;
};

export type QueryComparisonOperator<T> = {
  readonly $eq?: T;
  readonly $ne?: T;
  readonly $lt?: number;
  readonly $lte?: number;
  readonly $gt?: number;
  readonly $gte?: number;
  readonly $startsWith?: string;
  readonly $in?: T[];
  readonly $nin?: T[];
  readonly $regex?: string;
};

export type QueryComparisonField<E> = {
  readonly [P in Fields<E>]?: E[P] | E[P][] | QueryComparisonOperator<E[P]>;
};

export type QueryLogicalOperatorKey = '$and' | '$or';

export type QueryLogicalOperator<E> = {
  [p in QueryLogicalOperatorKey]?: (QueryComparisonField<E> | QueryComparison<E>)[];
};

export type QueryFilter<E> = QueryLogicalOperator<E> | QueryComparison<E> | QueryComparisonField<E>;

export type QuerySort<E> = {
  readonly [P in Fields<E>]?: -1 | 1;
};

export type QueryPager = {
  $skip?: number;
  $limit?: number;
};

export type QueryCriteria<E> = {
  $filter?: QueryFilter<E>;
  $group?: Fields<E>[];
  $having?: QueryFilter<E>;
  $sort?: QuerySort<E>;
} & QueryPager;

export type Query<E> = {
  $project?: QueryProject<E>;
  $populate?: QueryPopulate<E>;
} & QueryCriteria<E>;

export type QueryOne<E> = Query<E> & { $limit?: 1 };

export type QueryStringified = {
  readonly [P in keyof Query<any>]?: string;
};

export type QueryUpdateResult = {
  readonly changes?: number;
  readonly firstId?: number;
};
