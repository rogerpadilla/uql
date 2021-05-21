import { Properties, Relations } from './entity';
import { Scalar } from './utility';

export type QueryFieldFilter<E> = {
  readonly [P in Properties<E>]?: E[P] | QueryComparisonOperator<E> | Scalar;
};

export type QueryProject<E> =
  | Properties<E>[]
  | {
      [P in Properties<E>]?: boolean | 0 | 1;
    };

export type QueryPopulate<E> = {
  readonly [P in Relations<E>]?: Query<P> & { required?: boolean };
};

export type QueryTextSearchOptions<E> = {
  fields?: Properties<E>[];
  value: string;
};

export type QueryTextSearch<E> = {
  readonly $text?: QueryTextSearchOptions<E>;
};

export type QueryComparisonOperator<E> = {
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
  skip?: number;
  limit?: number;
};

export type QueryOne<E> = {
  project?: QueryProject<E>;
  populate?: QueryPopulate<E>;
  group?: Properties<E>[];
  sort?: QuerySort<E>;
} & QueryPager;

export type Query<E> = QueryOne<E> & {
  filter?: QueryFilter<E>;
};

export type QueryStringified = {
  readonly [P in keyof Query<any>]?: string;
};

export type QueryUpdateResult = {
  readonly affectedRows?: number;
  readonly insertId?: number;
};

export type QueryOptions = { isTrustedProject?: boolean };
