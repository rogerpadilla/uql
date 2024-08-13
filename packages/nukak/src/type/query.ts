import type { FieldKey, IdValue, Key, RelationKey } from './entity.js';
import type { BooleanLike, ExpandScalar, Scalar, Type, Unpacked } from './utility.js';

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

export type QuerySelectOptions = {
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
 * query selection as an array.
 */
export type QuerySelectArray<E> = readonly (Key<E> | QueryRaw)[];

/**
 * query selection as a map.
 */
export type QuerySelectMap<E> = QuerySelectFieldMap<E> | QuerySelectRelationMap<E>;

/**
 * query selection.
 */
export type QuerySelect<E> = QuerySelectArray<E> | QuerySelectMap<E>;

/**
 * query selection of fields as a map.
 */
export type QuerySelectFieldMap<E> = {
  readonly [K in FieldKey<E>]?: BooleanLike;
};

/**
 * query conflict paths map.
 */
export type QueryConflictPathsMap<E> = {
  readonly [K in FieldKey<E>]?: true;
};

/**
 * query conflict paths.
 */
export type QueryConflictPaths<E> = QueryConflictPathsMap<E>;

/**
 * query selection of relations as a map.
 */
export type QuerySelectRelationMap<E> = {
  readonly [K in RelationKey<E>]?: BooleanLike | readonly Key<Unpacked<E[K]>>[] | QuerySelectRelationOptions<E[K]>;
};

/**
 * options to select a relation.
 */
export type QuerySelectRelationOptions<E> = (E extends unknown[] ? Query<Unpacked<E>> : QueryUnique<Unpacked<E>>) & {
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
 * comparison by fields.
 */
export type QueryWhereFieldMap<E> = { readonly [K in FieldKey<E>]?: QueryWhereFieldValue<E[K]> };

/**
 * complex operators.
 */
export type QueryWhereMap<E> = QueryWhereFieldMap<E> & QueryWhereRootOperator<E>;

export type QueryWhereRootOperator<E> = {
  /**
   * joins query clauses with a logical `AND`, returns records that match all the clauses.
   */
  readonly $and?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that match any of the clauses.
   */
  readonly $or?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `AND`, returns records that do not match all the clauses.
   */
  readonly $not?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that do not match any of the clauses.
   */
  readonly $nor?: QueryWhereArray<E>;
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

export type QueryWhereFieldOperatorMap<T> = {
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
  readonly $not?: QueryWhereFieldValue<T>;
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
export type QueryWhereFieldValue<T> = T | readonly T[] | QueryWhereFieldOperatorMap<T> | QueryRaw;

/**
 * query single filter.
 */
export type QueryWhereSingle<E> = IdValue<E> | readonly IdValue<E>[] | QueryWhereMap<E> | QueryRaw;

/**
 * query filter array.
 */
export type QueryWhereArray<E> = readonly QueryWhereSingle<E>[];

/**
 * query filter.
 */
export type QueryWhere<E> = QueryWhereSingle<E> | QueryWhereArray<E>;

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
export type QuerySortFieldMap<E> = {
  readonly [K in FieldKey<E>]?: QuerySortDirection;
};

/**
 * sort by relations fields.
 */
export type QuerySortRelationMap<E> = {
  readonly [K in RelationKey<E>]?: QuerySortMap<Unpacked<E[K]>>;
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
  $where?: QueryWhere<E>;

  /**
   * sorting options.
   */
  $sort?: QuerySort<E>;
} & QueryPager;

/**
 * criteria one options.
 */
export type QuerySearchOne<E> = Omit<QuerySearch<E>, '$limit'>;

/**
 * query options.
 */
export type Query<E> = {
  /**
   * selection options.
   */
  $select?: QuerySelect<E>;
} & QuerySearch<E>;

/**
 * options to get a single record.
 */
export type QueryOne<E> = Omit<Query<E>, '$limit'>;

/**
 * options to get an unique record.
 */
export type QueryUnique<E> = Pick<QueryOne<E>, '$select' | '$where'>;

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
  readonly dialect?: QueryDialect;
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
  constructor(
    readonly value: Scalar | QueryRawFn,
    readonly alias?: string,
  ) {}
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
export type QueryWhereOptions = QueryComparisonOptions & {
  /**
   * clause to be used in the filter.
   */
  readonly clause?: 'WHERE' | false;
};

export interface QueryDialect {
  /**
   * obtains the records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  find<E>(entity: Type<E>, q: Query<E>, opts?: QueryOptions): string;

  /**
   * counts the number of records matching the given search parameters.
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  count<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): string;

  /**
   * insert records.
   * @param entity the target entity
   * @param qm the criteria options
   * @param opts the query options
   */
  insert<E>(entity: Type<E>, payload: E | readonly E[], opts?: QueryOptions): string;

  /**
   * update records.
   * @param entity the target entity
   * @param q the criteria options
   * @param payload
   * @param opts the query options
   */
  update<E>(entity: Type<E>, q: QuerySearch<E>, payload: E, opts?: QueryOptions): string;

  /**
   * upsert records.
   * @param entity the target entity
   * @param conflictPaths the conflict paths
   * @param payload
   */
  upsert<E>(entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): string;

  /**
   * delete records.
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  delete<E>(entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): string;

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
  escape(val: any): string;
}
