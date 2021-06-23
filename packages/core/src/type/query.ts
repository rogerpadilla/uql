import { FieldKey, Key, RelationKey } from './entity';
import { BooleanLike, Unpacked } from './utility';

export type QueryRaw = {
  readonly value: string;
  readonly alias?: string;
};

export type QueryProject<E> = QueryProjectArray<E> | QueryProjectObject<E>;

export type QueryProjectArray<E> = (Key<E> | QueryRaw)[];

export type QueryProjectField<E> = {
  [K in FieldKey<E>]?: BooleanLike;
};

export type QueryProjectRelation<E> = {
  [K in RelationKey<E>]?: BooleanLike | QueryProjectRelationValue<E[K]>;
};

export type QueryProjectRelationValue<E> = Query<Unpacked<E>> & { $required?: boolean };

export type QueryProjectObject<E> = QueryProjectField<E> | QueryProjectRelation<E>;

export type QueryTextSearchOptions<E> = {
  readonly $value: string;
  readonly $fields?: FieldKey<E>[];
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
  readonly $endsWith?: string;
  readonly $in?: T[];
  readonly $nin?: T[];
  readonly $regex?: string;
};

export type QueryComparisonField<E> = {
  readonly [K in FieldKey<E>]?: E[K] | E[K][] | QueryComparisonOperator<E[K]>;
};

export type QueryLogicalOperatorKey = '$and' | '$or';

export type QueryLogicalOperator<E> = {
  [K in QueryLogicalOperatorKey]?: (QueryComparisonField<E> | QueryComparison<E>)[];
};

export type QueryFilter<E> = QueryLogicalOperator<E> | QueryComparison<E> | QueryComparisonField<E>;

export type QuerySort<E> = {
  readonly [K in FieldKey<E>]?: -1 | 1;
};

export type QueryPager = {
  $skip?: number;
  $limit?: number;
};

export type QueryCriteria<E> = {
  $filter?: QueryFilter<E>;
  $group?: FieldKey<E>[];
  $having?: QueryFilter<E>;
  $sort?: QuerySort<E>;
} & QueryPager;

export type Query<E> = {
  $project?: QueryProject<E>;
} & QueryCriteria<E>;

export type QueryOne<E> = Query<E> & { $limit?: 1 };

export type QueryStringified = {
  readonly [K in keyof Query<any>]?: string;
};

export type QueryUpdateResult = {
  readonly changes?: number;
  readonly firstId?: number;
};
