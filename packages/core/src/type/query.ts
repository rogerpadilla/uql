export type QueryScalarValue = string | number | boolean | null;

export type QueryProject<T> = {
  [P in keyof T]: boolean | 0 | 1;
};

export type QueryPopulate<T> = {
  readonly [P in keyof T]?: QueryOne<T[P]> & { required?: boolean };
};

export type QueryFieldFilter<T> = {
  readonly [P in keyof T]: T[P] | QueryComparisonOperator<T> | QueryScalarValue;
};

export type QueryTextSearchOptions<T> = {
  fields?: (keyof T)[];
  value: string;
};

export type QueryTextSearch<T> = {
  readonly $text?: QueryTextSearchOptions<T>;
};

export type QueryComparisonOperator<T> = {
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

export type QueryLogicalOperatorKey = keyof QueryLogicalOperatorMap;

export type QueryLogicalOperatorValue = QueryLogicalOperatorMap[QueryLogicalOperatorKey];

export type QueryLogicalOperator<T> = {
  [p in keyof QueryLogicalOperatorMap]: QueryFieldFilter<T> | QueryTextSearch<T>;
};

export type QueryFilter<T> = QueryLogicalOperator<T> | QueryTextSearch<T> | QueryFieldFilter<T>;

export type QuerySort<T> = {
  readonly [P in keyof T]: -1 | 1;
};

export type QueryPager = {
  skip?: number;
  limit?: number;
};

export type QueryOne<T> = {
  project?: QueryProject<T>;
  populate?: QueryPopulate<T>;
  group?: (keyof T)[];
  sort?: QuerySort<T>;
} & QueryPager;

export type Query<T> = QueryOne<T> & {
  filter?: QueryFilter<T>;
};

export type QueryStringified = {
  readonly [P in keyof Query<any>]?: string;
};

export type QueryUpdateResult = {
  readonly affectedRows?: number;
  readonly insertId?: number;
};

export type QueryOptions = { isTrustedProject?: boolean };
