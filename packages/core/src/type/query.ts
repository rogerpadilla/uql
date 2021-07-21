import { FieldKey, FieldValue, Key, RelationKey } from './entity';
import { BooleanLike, Scalar, Type, Unpacked } from './utility';

export type QueryOptions = {
  readonly softDelete?: boolean;
  readonly prefix?: string;
  readonly autoPrefix?: boolean;
};

export type QueryProjectOptions = {
  readonly prefix?: string;
  readonly autoPrefixAlias?: boolean;
};

export type QueryProjectArray<E> = readonly (Key<E> | QueryRaw)[];

export type QueryProjectMap<E> = QueryProjectField<E> | QueryProjectRelation<E>;

export type QueryProject<E> = QueryProjectArray<E> | QueryProjectMap<E>;

export type QueryProjectField<E> =
  | {
      [K in FieldKey<E>]?: BooleanLike;
    }
  | { [K: string]: QueryRaw };

export type QueryProjectRelation<E> = {
  [K in RelationKey<E>]?: BooleanLike | readonly Key<Unpacked<E[K]>>[] | (Query<Unpacked<E[K]>> & { readonly $required?: boolean });
};

export type QueryLogicalEntry<E> = readonly (FieldValue<E> | QueryFilterFieldComparison<E> | QueryRaw)[];

export type QueryTextSearchOptions<E> = {
  readonly $value: string;
  readonly $fields?: readonly FieldKey<E>[];
};

export type QueryFilterMultiFieldOperator<E> = {
  readonly $and?: QueryLogicalEntry<E>;
  readonly $or?: QueryLogicalEntry<E>;
  readonly $not?: QueryLogicalEntry<E>;
  readonly $nor?: QueryLogicalEntry<E>;
  readonly $text?: QueryTextSearchOptions<E>;
  readonly $exists?: QueryRaw;
  readonly $nexists?: QueryRaw;
};

export type QueryFilterSingleFieldOperator<V> = {
  readonly $eq?: V;
  readonly $ne?: V;
  readonly $lt?: number;
  readonly $lte?: number;
  readonly $gt?: number;
  readonly $gte?: number;
  readonly $startsWith?: string;
  readonly $istartsWith?: string;
  readonly $endsWith?: string;
  readonly $iendsWith?: string;
  readonly $includes?: string;
  readonly $iincludes?: string;
  readonly $like?: string;
  readonly $ilike?: string;
  readonly $regex?: string;
  readonly $in?: readonly V[];
  readonly $nin?: readonly V[];
};

export type QueryFieldValue<V> = V | readonly V[] | QueryFilterSingleFieldOperator<V> | QueryRaw;

export type QueryFilterFieldComparison<E> = {
  readonly [K in FieldKey<E>]?: QueryFieldValue<E[K]>;
};

export type QueryFilterComparison<E> = QueryFilterFieldComparison<E> | QueryFilterMultiFieldOperator<E>;

export type QueryFilter<E> = FieldValue<E> | readonly FieldValue<E>[] | QueryFilterComparison<E> | QueryRaw;

export type QuerySortDirection = -1 | 1 | 'asc' | 'desc';

export type QuerySortArrays<E> = readonly [FieldKey<E>, QuerySortDirection][];

export type QuerySortObjects<E> = readonly { readonly field: FieldKey<E>; readonly sort: QuerySortDirection }[];

export type QuerySortField<E> = {
  [K in FieldKey<E>]?: QuerySortDirection;
};

export type QuerySortRelation<E> = {
  [K in RelationKey<E>]?: QuerySortMap<Unpacked<E[K]>>;
};

export type QuerySortMap<E> = QuerySortField<E> | QuerySortRelation<E>;

export type QuerySort<E> = QuerySortMap<E> | QuerySortArrays<E> | QuerySortObjects<E>;

export type QueryPager = {
  $skip?: number;
  $limit?: number;
};

export type QuerySearch<E> = {
  $filter?: QueryFilter<E>;
  $group?: readonly FieldKey<E>[];
  $having?: QueryFilter<E>;
};

export type QueryCriteria<E> = QuerySearch<E> & {
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

export type QueryRawFnOptions = {
  readonly dialect: QueryDialect;
  readonly prefix?: string;
  readonly escapedPrefix?: string;
};

export type QueryRawFn = (opts?: QueryRawFnOptions) => Scalar;

export type QueryRaw = {
  readonly value: Scalar | QueryRawFn;
  readonly alias?: string;
};

export type QueryComparisonOptions = QueryOptions & {
  readonly usePrecedence?: boolean;
};

export type QueryFilterOptions = QueryComparisonOptions & {
  readonly clause?: 'WHERE' | 'HAVING' | false;
};

export interface QueryDialect {
  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions): string;

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  insert<E>(entity: Type<E>, payload: E | readonly E[], opts?: QueryOptions): string;

  update<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E, opts?: QueryOptions): string;

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): string;

  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string;

  escape(val: any): Scalar;
}
