type Properties<E> = {
  [K in keyof E]: E[K] extends QueryScalarValue ? K : never;
}[keyof E];

type Relations<E> = {
  [K in keyof E]: E[K] extends QueryScalarValue ? never : K;
}[keyof E];

type QueryPopulateValue<P> = Query<P> & { required?: boolean };

type QueryFieldFilter<E> = {
  readonly [P in Properties<E>]?: E[P] | QueryComparisonOperator<E> | QueryScalarValue;
};

export type QueryScalarValue = null | boolean | string | number | BigInt | Date;

export type QueryProject<E> =
  | Properties<E>[]
  | {
      [P in Properties<E>]?: boolean | 0 | 1;
    };

export type QueryPopulate<E> = {
  readonly [P in Relations<E>]?: QueryPopulateValue<E[P]>;
};

export type QueryTextSearchOptions<E> = {
  fields?: Properties<E>[];
  value: string;
};

export type QueryTextSearch<E> = {
  readonly $text?: QueryTextSearchOptions<E>;
};

export type QueryComparisonOperator<E> = {
  readonly $eq?: QueryScalarValue;
  readonly $ne?: QueryScalarValue;
  readonly $lt?: number;
  readonly $lte?: number;
  readonly $gt?: number;
  readonly $gte?: number;
  readonly $startsWith?: string;
  readonly $in?: QueryScalarValue[];
  readonly $nin?: QueryScalarValue[];
  readonly $re?: string;
};

export type QueryLogicalOperatorMap = {
  readonly $and?: 'AND';
  readonly $or?: 'OR';
};

export type QueryLogicalOperatorValue = QueryLogicalOperatorMap[keyof QueryLogicalOperatorMap];

export type QueryLogicalOperator<E> = {
  [p in keyof QueryLogicalOperatorMap]: QueryFieldFilter<E> | QueryTextSearch<E>;
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
