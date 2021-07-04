import { FieldKey, FieldValue, Key, RelationKey } from './entity';
import { BooleanLike, Scalar, Type, Unpacked } from './utility';

export type QueryOptions = { readonly prefix?: string; readonly usePrefix?: boolean; readonly softDelete?: boolean };

export type QueryProjectArray<E> = (Key<E> | QueryRaw)[];

export type QueryProjectMap<E> = QueryProjectField<E> | QueryProjectRelation<E>;

export type QueryProject<E> = QueryProjectArray<E> | QueryProjectMap<E>;

export type QueryProjectField<E> =
  | {
      [K in FieldKey<E>]?: BooleanLike;
    }
  | { [K: string]: QueryRaw };

export type QueryProjectRelation<E> = {
  [K in RelationKey<E>]?:
    | BooleanLike
    | Key<Unpacked<E[K]>>[]
    | (Query<Unpacked<E[K]>> & { readonly $required?: boolean });
};

export type QueryLogicalEntry<E> = (FieldValue<E> | QueryFilterFieldComparison<E> | QueryRaw)[];

export type QueryTextSearchOptions<E> = {
  readonly $value: string;
  readonly $fields?: FieldKey<E>[];
};

export type QueryFilterMultiFieldOperator<E> = {
  readonly $and?: QueryLogicalEntry<E>;
  readonly $or?: QueryLogicalEntry<E>;
  readonly $not?: QueryLogicalEntry<E>;
  readonly $nor?: QueryLogicalEntry<E>;
  readonly $text?: QueryTextSearchOptions<E>;
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
  readonly $like?: string;
  readonly $ilike?: string;
  readonly $in?: V[];
  readonly $nin?: V[];
  readonly $regex?: string;
};

export type QueryFieldValue<V> = V | V[] | QueryFilterSingleFieldOperator<V> | QueryRaw;

export type QueryFilterFieldComparison<E> = {
  readonly [K in FieldKey<E>]?: QueryFieldValue<E[K]>;
};

export type QueryFilterComparison<E> = QueryFilterFieldComparison<E> | QueryFilterMultiFieldOperator<E>;

export type QueryFilter<E> = FieldValue<E> | FieldValue<E>[] | QueryFilterComparison<E>;

export type QuerySort<E> = {
  readonly [K in FieldKey<E>]?: -1 | 1;
};

export type QueryPager = {
  $skip?: number;
  $limit?: number;
};

export type QuerySearch<E> = {
  $filter?: QueryFilter<E>;
  $group?: FieldKey<E>[];
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
  criteria<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions): string;

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  insert<E>(entity: Type<E>, payload: E | E[], opts?: QueryOptions): string;

  update<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E, opts?: QueryOptions): string;

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): string;

  project<E>(entity: Type<E>, project: QueryProject<E>, opts: QueryOptions): string;

  populate<E>(entity: Type<E>, opts?: QueryOptions): { joinsColumns: string; joinsTables: string };

  select<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  filter<E>(entity: Type<E>, filter: QueryFilter<E>, opts?: QueryFilterOptions): string;

  compare<E, K extends keyof QueryFilterComparison<E>>(
    entity: Type<E>,
    key: K,
    val: QueryFieldValue<E[K]>,
    opts?: QueryComparisonOptions
  ): string;

  compareSingleOperator<E, K extends keyof QueryFilterComparison<E>>(
    entity: Type<E>,
    key: K,
    op: keyof QueryFilterSingleFieldOperator<E>,
    val: QueryFieldValue<E[K]>,
    opts?: QueryOptions
  ): string;

  group<E>(entity: Type<E>, fields: readonly FieldKey<E>[], opts?: QueryOptions): string;

  sort<E>(entity: Type<E>, sort: QuerySort<E>, opts?: QueryOptions): string;

  pager(value: QueryPager): string;

  escapeId(val: string, forbidQualified?: boolean): string;

  escape(val: any): Scalar;
}
