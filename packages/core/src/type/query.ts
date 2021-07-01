import { FieldKey, FieldValue, Key, RelationKey } from './entity';
import { BooleanLike, Scalar, Type, Unpacked } from './utility';

export type QueryOptions = { readonly softDelete?: boolean };

export type QueryProjectArray<E> = (Key<E> | QueryRaw)[];

export type QueryProjectMap<E> = QueryProjectField<E> | QueryProjectRelation<E>;

export type QueryProject<E> = QueryProjectArray<E> | QueryProjectMap<E>;

export type QueryProjectField<E> =
  | {
      [K in FieldKey<E>]?: BooleanLike;
    }
  | { [K: string]: QueryRaw };

export type QueryProjectRelation<E> = {
  [K in RelationKey<E>]?: BooleanLike | Key<Unpacked<E[K]>>[] | QueryProjectRelationValue<E[K]>;
};

export type QueryProjectRelationValue<E> = Query<Unpacked<E>> & { $required?: boolean };

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

export type QuerySingleField<E> = {
  readonly [K in FieldKey<E>]?: E[K] | E[K][] | QuerySingleFieldOperator<E[K]>;
};

export type QueryTextSearchOptions<E> = {
  readonly $value: string;
  readonly $fields?: FieldKey<E>[];
};

export type QueryMultipleFieldOperator<E> = {
  readonly $text?: QueryTextSearchOptions<E>;
};

export type QueryField<E> = QuerySingleField<E> | QueryMultipleFieldOperator<E>;

export type QueryLogicalOperatorKey = '$and' | '$or';

export type QueryLogicalOperator<E> = {
  [K in QueryLogicalOperatorKey]?: QueryField<E>[];
};

export type QueryFilter<E> = FieldValue<E> | FieldValue<E>[] | QueryField<E> | QueryLogicalOperator<E>;

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

export type QueryRawFn = (prefix: string, dialect: QueryDialect) => string;

export type QueryRaw = {
  readonly value: string | QueryRawFn;
  readonly alias?: string;
};

export interface QueryDialect {
  criteria<E>(entity: Type<E>, qm: Query<E>, opts?: QueryOptions): string;

  find<E>(entity: Type<E>, qm: Query<E>): string;

  insert<E>(entity: Type<E>, payload: E | E[]): string;

  update<E>(entity: Type<E>, payload: E, qm: QueryCriteria<E>): string;

  delete<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions): string;

  project<E>(entity: Type<E>, project: QueryProject<E>, opts: { prefix?: string; usePrefixInAlias?: boolean }): string;

  populate<E>(entity: Type<E>, prefix?: string): { joinsColumns: string; joinsTables: string };

  select<E>(entity: Type<E>, qm: Query<E>): string;

  filter<E>(
    entity: Type<E>,
    filter: QueryFilter<E>,
    opts?: QueryOptions & { prefix?: string; wrapWithParenthesis?: boolean; clause?: 'WHERE' | 'HAVING' | false }
  ): string;

  compare<E>(entity: Type<E>, key: string, value: Scalar | object | Scalar[], opts?: { prefix?: string }): string;

  compareOperator<E, K extends keyof QuerySingleFieldOperator<E>>(
    entity: Type<E>,
    key: string,
    operator: K,
    val: QuerySingleFieldOperator<E>[K],
    opts?: { prefix?: string }
  ): string;

  group<E>(entity: Type<E>, fields: FieldKey<E>[]): string;

  sort<E>(entity: Type<E>, sort: QuerySort<E>): string;

  pager(opts: QueryPager): string;

  escapeId(val: string, forbidQualified?: boolean): string;

  escape(val: any): string;

  objectToValues<E>(payload: E): string;
}
