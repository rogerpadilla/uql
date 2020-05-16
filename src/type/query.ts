export type QueryPrimitive = string | number | boolean;

export type QueryFieldFilter<T> = {
  readonly [P in keyof T]: T[P] | string | QueryComparisonOperator<T>;
};

export type QueryComparisonValue<T> = QueryPrimitive | QueryPrimitive[] | QueryComparisonOperator<T> | QueryTextSearchOptions<T>;

export type QueryLogicalOperators = 'AND' | 'OR';

export type QueryTextSearchOptions<T> = {
  fields: (keyof T)[];
  value: string;
};

export type QueryTextSearch<T> = {
  readonly $text?: QueryTextSearchOptions<T>;
};

export type QueryComparisonOperator<T> = {
  readonly $eq?: QueryPrimitive;
  readonly $ne?: QueryPrimitive;
  readonly $lt?: number;
  readonly $lte?: number;
  readonly $gt?: number;
  readonly $gte?: number;
  readonly $startsWith?: string;
  readonly $in?: QueryPrimitive[];
  readonly $nin?: QueryPrimitive[];
};

export type QueryProject<T> = {
  readonly [P in keyof T]: 1 | 0 | boolean;
};

export type QueryPopulate<T> = {
  readonly [P in keyof T]?: QueryOne<T[P]>;
};

export type QueryLogicalOperator<T> = {
  readonly $and?: QueryFieldFilter<T> | QueryTextSearch<T>;
  readonly $or?: QueryFieldFilter<T> | QueryTextSearch<T>;
};

export type QuerySort<T> = {
  readonly [P in keyof T]: 1 | -1;
};

export type QueryPager = {
  skip?: number;
  limit?: number;
};

export type QueryFilter<T> = QueryLogicalOperator<T> | QueryTextSearch<T> | QueryFieldFilter<T>;

export type QueryOne<T> = {
  project?: QueryProject<T>;
  populate?: QueryPopulate<T>;
};

export type QueryOneFilter<T> = QueryOne<T> & {
  filter?: QueryFilter<T>;
};

export type Query<T> = QueryOneFilter<T> & QueryPager & { sort?: QuerySort<T> };

export type QueryStringified = {
  readonly [P in keyof Query<any>]?: any;
};

export type QueryUpdateResult = {
  readonly affectedRows?: number;
  readonly insertId?: number;
};

export type QueryOptions = { trustedProject?: boolean };
