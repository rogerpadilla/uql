export type QueryPrimitive = string | number | boolean;

export type QueryFilter<T> = QueryFieldFilter<T> | QueryLogicalOperator<T> | QueryTextSearch<T>;

export type QueryFieldFilter<T> = {
  readonly [P in keyof T]: T[P] | string | QueryComparisonOperator<T>;
};

export type QueryComparisonValue<T> =
  | QueryPrimitive
  | QueryPrimitive[]
  | QueryComparisonOperator<T>
  | QueryTextSearchProperties<T>
  | null;

export type QueryLogicalOperator<T> = {
  readonly $and?: QueryFieldFilter<T>;
  readonly $or?: QueryFieldFilter<T>;
};

export type QueryLogicalOperators = 'AND' | 'OR';

export type QueryTextSearchProperties<T> = {
  fields: (keyof T)[];
  value: string;
};

export type QueryTextSearch<T> = {
  $text?: QueryTextSearchProperties<T>;
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

export type QueryLimit = {
  skip?: number;
  limit?: number;
};

export type QueryPopulate<T> = {
  project?: QueryProject<T>;
  populate?: { [P in keyof T]: QueryPopulate<T[P]> };
};

export type QueryProject<T> = {
  readonly [P in keyof T]: 1 | 0;
};

export type QuerySort<T> = {
  readonly [P in keyof T]: 1 | -1;
};

export type QueryOne<T> = QueryPopulate<T> & {
  filter?: QueryFilter<T>;
};

export type Query<T> = QueryOne<T> & QueryLimit & { sort?: QuerySort<T> };

export type QueryStringified = {
  readonly [P in keyof Query<unknown>]?: any;
};

export type QueryUpdateResult = {
  readonly affectedRows?: number;
  readonly insertId?: number;
};

export type QueryOptions = { trustedProject?: boolean };
