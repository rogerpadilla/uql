import { FieldKey, IdValue, Key, RelationKey } from './entity.js';
import { BooleanLike, ExpandScalar, Scalar, Type, Unpacked } from './utility.js';

export type QueryOptions = {
  /**
   * use or omit `softDelete` attribute.
   */
  readonly softDelete?: boolean;
  /**
   * prefix the query with this.
   */
  readonly prefix?: string;
  /**
   * automatically infer the prefix for the query.
   */
  readonly autoPrefix?: boolean;
};

export type QueryProjectOptions = {
  /**
   * prefix the query with this.
   */
  readonly prefix?: string;
  /**
   * automatically add the prefix for the alias.
   */
  readonly autoPrefixAlias?: boolean;
};

/**
 * query projection of operations
 */
export type QueryProjectOperation<E> = {
  /**
   * Calculates the quantity of entries
   */
  readonly $count?: FieldKey<E> | 1;

  /**
   * Gets the maximum value of a field in the entity
   */
  readonly $max?: FieldKey<E>;

  /**
   * Gets the minimum value of a field in the entity
   */
  readonly $min?: FieldKey<E>;

  /**
   * Gets the average value of a field in the entity
   */
  readonly $avg?: FieldKey<E>;

  /**
   * Sums up the specified values of all entries in the entity
   */
  readonly $sum?: FieldKey<E>;
};

/**
 * query projection as an array.
 */
export type QueryProjectArray<E> = readonly (Key<E> | QueryRaw)[];

/**
 * query projection as a map.
 */
export type QueryProjectMap<E> = QueryProjectFieldMap<E> | QueryProjectRelationMap<E>;

/**
 * query projection.
 */
export type QueryProject<E> = QueryProjectArray<E> | QueryProjectMap<E>;

/**
 * query projection of fields as a map.
 */
export type QueryProjectFieldMap<E> =
  | {
      // TODO add support to use alias for projected fields (string value)
      [K in FieldKey<E>]?: BooleanLike;
    }
  | { [K: string]: QueryProjectOperation<E> | QueryRaw };

/**
 * query projection of relations as a map.
 */
export type QueryProjectRelationMap<E> = {
  [K in RelationKey<E>]?: BooleanLike | readonly Key<Unpacked<E[K]>>[] | QueryProjectRelationOptions<E[K]>;
};

/**
 * options to project a relation.
 */
export type QueryProjectRelationOptions<E> = (E extends unknown[] ? Query<Unpacked<E>> : QueryUnique<Unpacked<E>>) & {
  readonly $required?: boolean;
};

/**
 * options for full-text-search operator.
 */
export type QueryTextSearchOptions<E> = {
  /**
   * text to search for.
   */
  readonly $value: string;
  /**
   * list of fields to search on.
   */
  readonly $fields?: readonly FieldKey<E>[];
};

/**
 * value for a logical filtering.
 */
export type QueryFilterLogical<E> = readonly QueryFilter<E>[];

/**
 * comparison by fields.
 */
export type QueryFilterFieldMap<E> =
  | { readonly [K in FieldKey<E>]?: QueryFilterFieldValue<E[K]> }
  | { readonly [K: string]: QueryFilterFieldValue<E[any]> };

/**
 * complex operators.
 */
export type QueryFilterMap<E> = QueryFilterFieldMap<E> & {
  /**
   * joins query clauses with a logical `AND`, returns records that match all the clauses.
   */
  readonly $and?: QueryFilterLogical<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that match any of the clauses.
   */
  readonly $or?: QueryFilterLogical<E>;
  /**
   * joins query clauses with a logical `AND`, returns records that do not match all the clauses.
   */
  readonly $not?: QueryFilterLogical<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that do not match any of the clauses.
   */
  readonly $nor?: QueryFilterLogical<E>;
  /**
   * whether the specified fields match against a full-text search of the given string.
   */
  readonly $text?: QueryTextSearchOptions<E>;
  /**
   * whether the record exists in the given sub-query.
   */
  readonly $exists?: QueryRaw;
  /**
   * whether the record does not exists in the given sub-query.
   */
  readonly $nexists?: QueryRaw;
};

export type QueryFilterFieldOperatorMap<T> = {
  /**
   * whether a value is equal to the given value.
   */
  readonly $eq?: ExpandScalar<T>;
  /**
   * whether a value is not equal to the given value.
   */
  readonly $ne?: ExpandScalar<T>;
  /**
   * negates the given comparison.
   */
  readonly $not?: QueryFilterFieldValue<T>;
  /**
   * whether a value is less than the given value.
   */
  readonly $lt?: ExpandScalar<T>;
  /**
   * whether a value is less than or equal to the given value.
   */
  readonly $lte?: ExpandScalar<T>;
  /**
   * whether a value is greater than the given value.
   */
  readonly $gt?: ExpandScalar<T>;
  /**
   * whether a value is greater than or equal to the given value.
   */
  readonly $gte?: ExpandScalar<T>;
  /**
   * whether a string begins with the given string (case sensitive).
   */
  readonly $startsWith?: string;
  /**
   * whether a string begins with the given string (case insensitive).
   */
  readonly $istartsWith?: string;
  /**
   * whether a string ends with the given string (case sensitive).
   */
  readonly $endsWith?: string;
  /**
   * whether a string ends with the given string (case insensitive).
   */
  readonly $iendsWith?: string;
  /**
   * whether a string is contained within the given string (case sensitive).
   */
  readonly $includes?: string;
  /**
   * whether a string is contained within the given string (case insensitive).
   */
  readonly $iincludes?: string;
  /**
   * whether a string fulfills the given pattern (case sensitive).
   */
  readonly $like?: string;
  /**
   * whether a string fulfills the given pattern (case insensitive).
   */
  readonly $ilike?: string;
  /**
   * whether a string matches the given regular expression.
   */
  readonly $regex?: string;
  /**
   * whether a value matches any of the given values.
   */
  readonly $in?: readonly ExpandScalar<T>[];
  /**
   * whether a value does not match any of the given values.
   */
  readonly $nin?: readonly ExpandScalar<T>[];
};

/**
 * Value for a field comparison.
 */
export type QueryFilterFieldValue<T> = T | readonly T[] | QueryFilterFieldOperatorMap<T> | QueryRaw;

/**
 * query filter.
 */
export type QueryFilter<E> = IdValue<E> | readonly IdValue<E>[] | QueryRaw | QueryFilterMap<E>;

/**
 * direction for the sort.
 */
export type QuerySortDirection = -1 | 1 | 'asc' | 'desc';

/**
 * sort by tuples
 */
export type QuerySortTuples<E> = readonly [FieldKey<E>, QuerySortDirection][];

/**
 * sort by objects.
 */
export type QuerySortObjects<E> = readonly { readonly field: FieldKey<E>; readonly sort: QuerySortDirection }[];

/**
 * sort by fields.
 */
export type QuerySortFieldMap<E> =
  | {
      [K in FieldKey<E>]?: QuerySortDirection;
    }
  | { [K: string]: QuerySortDirection };

/**
 * sort by relations fields.
 */
export type QuerySortRelationMap<E> = {
  [K in RelationKey<E>]?: QuerySortMap<Unpacked<E[K]>>;
};

/**
 * sort by map.
 */
export type QuerySortMap<E> = QuerySortFieldMap<E> | QuerySortRelationMap<E>;

/**
 * sort options.
 */
export type QuerySort<E> = QuerySortMap<E> | QuerySortTuples<E> | QuerySortObjects<E>;

/**
 * pager options.
 */
export type QueryPager = {
  /**
   * Index from where start the search
   */
  $skip?: number;

  /**
   * Max number of records to retrieve
   */
  $limit?: number;
};

/**
 * search options.
 */
export type QuerySearch<E> = {
  /**
   * filtering options.
   */
  $filter?: QueryFilter<E>;

  /**
   * list of fields to group.
   */
  $group?: readonly FieldKey<E>[];

  /**
   * having options.
   */
  $having?: QueryFilter<E>;
} & QueryPager;

/**
 * criteria options.
 */
export type QueryCriteria<E> = QuerySearch<E> & {
  /**
   * sorting options.
   */
  $sort?: QuerySort<E>;
};

/**
 * criteria one options.
 */
export type QueryOneCriteria<E> = Omit<QueryCriteria<E>, '$limit'>;

/**
 * query options.
 */
export type Query<E> = {
  /**
   * projection options.
   */
  $project?: QueryProject<E>;
} & QueryCriteria<E>;

/**
 * options to get a single record.
 */
export type QueryOne<E> = Omit<Query<E>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E> = Pick<QueryOne<E>, '$project' | '$filter'>;

/**
 * stringified query.
 */
export type QueryStringified = {
  readonly [K in keyof Query<any>]?: string;
};

/**
 * result of an update operation.
 */
export type QueryUpdateResult = {
  /**
   * number of changes.
   */
  readonly changes?: number;
  /**
   * first inserted ID.
   */
  readonly firstId?: number;
};

/**
 * options for the `raw` function.
 */
export type QueryRawFnOptions = {
  /**
   * the current dialect.
   */
  readonly dialect: QueryDialect;
  /**
   * the prefix.
   */
  readonly prefix?: string;
  /**
   * the escaped prefix.
   */
  readonly escapedPrefix?: string;
};

/**
 * a `raw` function
 */
export type QueryRawFn = (opts?: QueryRawFnOptions) => string;

export class QueryRaw {
  constructor(readonly value: Scalar | QueryRawFn, readonly alias?: string) {}
}

/**
 * comparison options.
 */
export type QueryComparisonOptions = QueryOptions & {
  /**
   * use precedence for the comparison or not.
   */
  readonly usePrecedence?: boolean;
};

/**
 * query filter options.
 */
export type QueryFilterOptions = QueryComparisonOptions & {
  /**
   * clause to be used in the filter.
   */
  readonly clause?: 'WHERE' | 'HAVING' | false;
};

export interface QueryDialect {
  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param qm the criteria options
   * @param opts the query options
   */
  find<E, P extends QueryProject<E>>(entity: Type<E>, qm: QueryCriteria<E>, project?: P, opts?: QueryOptions): string;

  /**
   * counts the number of records matching the given search parameters.
   * @param entity the target entity
   * @param qm the criteria options
   * @param opts the query options
   */
  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions): string;

  /**
   * inser records.
   * @param entity the target entity
   * @param qm the criteria options
   * @param opts the query options
   */
  insert<E>(entity: Type<E>, payload: E | readonly E[], opts?: QueryOptions): string;

  /**
   * update records.
   * @param entity the target entity
   * @param qm the criteria options
   * @param payload
   * @param opts the query options
   */
  update<E>(entity: Type<E>, qm: QuerySearch<E>, payload: E, opts?: QueryOptions): string;

  /**
   * delete records.
   * @param entity the target entity
   * @param qm the criteria options
   * @param opts the query options
   */
  delete<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions): string;

  /**
   * escape an identifier.
   * @param val the value to be escaped
   * @param forbidQualified don't escape dots
   * @param addDot use a dot as suffix
   */
  escapeId(val: string, forbidQualified?: boolean, addDot?: boolean): string;

  /**
   * escape a value.
   * @param val the value to escape
   */
  escape(val: any): Scalar;
}

export type Merge<E, P> = E & (P extends string[] ? {} : { [K in Exclude<keyof P, keyof E>]: Scalar });
