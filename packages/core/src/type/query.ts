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

export type QuerySingleFieldOperator<T> = {
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

export type QueryTextSearchOptions<E> = {
  readonly $value: string;
  readonly $fields?: FieldKey<E>[];
};

export type QueryMultipleFieldOperator<E> = {
  readonly $text?: QueryTextSearchOptions<E>;
};

export type QueryFieldValue<V> = V | V[] | QuerySingleFieldOperator<V> | QueryRaw;

export type QueryFieldMap<E> =
  | {
      readonly [K in FieldKey<E>]?: QueryFieldValue<E[K]>;
    }
  | QueryMultipleFieldOperator<E>;

export type QueryLogicalOperatorKey = '$and' | '$or';

export type QueryLogicalOperator<E> = {
  readonly [K in QueryLogicalOperatorKey]?: (FieldValue<E> | QueryFieldMap<E> | QueryRaw)[];
};

export type QueryFilter<E> = FieldValue<E> | FieldValue<E>[] | QueryFieldMap<E> | QueryLogicalOperator<E>;

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

export type QueryRawFnOptions = {
  readonly escapedPrefix?: string;
  readonly prefix?: string;
  readonly dialect?: QueryDialect;
};

export type QueryRawFn = (opts: QueryRawFnOptions) => Scalar;

export type QueryRaw = {
  readonly value: Scalar | QueryRawFn;
  readonly alias?: string;
};

export type QueryFilterOptions = QueryOptions & {
  readonly usePrecedence?: boolean;
  readonly clause?: 'WHERE' | 'HAVING' | false;
};

export interface QueryDialect {
  criteria<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  find<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  insert<E>(entity: Type<E>, payload: E | E[], opts?: QueryOptions): string;

  update<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>, opts?: QueryOptions): string;

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): string;

  project<E>(entity: Type<E>, project: QueryProject<E>, opts: QueryOptions): string;

  populate<E>(entity: Type<E>, opts?: QueryOptions): { joinsColumns: string; joinsTables: string };

  select<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  filter<E>(entity: Type<E>, filter: QueryFilter<E>, opts?: QueryFilterOptions): string;

  compare<E, K extends FieldKey<E>>(entity: Type<E>, key: K, val: QueryFieldValue<E[K]>, opts?: QueryOptions): string;

  compareOperator<E, K extends FieldKey<E>>(
    entity: Type<E>,
    key: K,
    op: keyof QuerySingleFieldOperator<E>,
    val: QueryFieldValue<E[K]>,
    opts?: QueryOptions
  ): string;

  group<E>(entity: Type<E>, fields: readonly FieldKey<E>[], opts?: QueryOptions): string;

  sort<E>(entity: Type<E>, sort: QuerySort<E>, opts?: QueryOptions): string;

  pager(value: QueryPager): string;

  escapeId(val: string, forbidQualified?: boolean): string;

  escape(val: any): string;
}
