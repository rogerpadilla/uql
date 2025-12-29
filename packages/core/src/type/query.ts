import type { FieldKey, IdValue, Key, RelationKey } from './entity.js';
import type { BooleanLike, ExpandScalar, Scalar, Type, Unpacked } from './utility.js';

export type QueryOptions = {
  /**
   * use or omit `softDelete` attribute.
   */
  softDelete?: boolean;
  /**
   * prefix the query with this.
   */
  prefix?: string;
  /**
   * automatically infer the prefix for the query.
   */
  autoPrefix?: boolean;
};

export type QuerySelectOptions = {
  /**
   * prefix the query with this.
   */
  prefix?: string;
  /**
   * automatically add the prefix for the alias.
   */
  autoPrefixAlias?: boolean;
};

/**
 * query selection as an array.
 */
export type QuerySelectArray<E> = (Key<E> | QueryRaw)[];

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
  [K in FieldKey<E>]?: BooleanLike;
};

/**
 * query conflict paths map.
 */
export type QueryConflictPathsMap<E> = {
  [K in FieldKey<E>]?: true;
};

/**
 * query conflict paths.
 */
export type QueryConflictPaths<E> = QueryConflictPathsMap<E>;

/**
 * query selection of relations as a map.
 */
export type QuerySelectRelationMap<E> = {
  [K in RelationKey<E>]?: BooleanLike | Key<Unpacked<E[K]>>[] | QuerySelectRelationOptions<E[K]>;
};

/**
 * options to select a relation.
 */
export type QuerySelectRelationOptions<E> = (E extends unknown[] ? Query<Unpacked<E>> : QueryUnique<Unpacked<E>>) & {
  $required?: boolean;
};

/**
 * options for full-text-search operator.
 */
export type QueryTextSearchOptions<E> = {
  /**
   * text to search for.
   */
  $value: string;
  /**
   * list of fields to search on.
   */
  $fields?: FieldKey<E>[];
};

/**
 * comparison by fields.
 */
export type QueryWhereFieldMap<E> = { [K in FieldKey<E>]?: QueryWhereFieldValue<E[K]> };

/**
 * complex operators.
 */
export type QueryWhereMap<E> = QueryWhereFieldMap<E> & QueryWhereRootOperator<E>;

export type QueryWhereRootOperator<E> = {
  /**
   * joins query clauses with a logical `AND`, returns records that match all the clauses.
   */
  $and?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that match any of the clauses.
   */
  $or?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `AND`, returns records that do not match all the clauses.
   */
  $not?: QueryWhereArray<E>;
  /**
   * joins query clauses with a logical `OR`, returns records that do not match any of the clauses.
   */
  $nor?: QueryWhereArray<E>;
  /**
   * whether the specified fields match against a full-text search of the given string.
   */
  $text?: QueryTextSearchOptions<E>;
  /**
   * whether the record exists in the given sub-query.
   */
  $exists?: QueryRaw;
  /**
   * whether the record does not exists in the given sub-query.
   */
  $nexists?: QueryRaw;
};

export type QueryWhereFieldOperatorMap<T> = {
  /**
   * whether a value is equal to the given value.
   */
  $eq?: ExpandScalar<T>;
  /**
   * whether a value is not equal to the given value.
   */
  $ne?: ExpandScalar<T>;
  /**
   * negates the given comparison.
   */
  $not?: QueryWhereFieldValue<T>;
  /**
   * whether a value is less than the given value.
   */
  $lt?: ExpandScalar<T>;
  /**
   * whether a value is less than or equal to the given value.
   */
  $lte?: ExpandScalar<T>;
  /**
   * whether a value is greater than the given value.
   */
  $gt?: ExpandScalar<T>;
  /**
   * whether a value is greater than or equal to the given value.
   */
  $gte?: ExpandScalar<T>;
  /**
   * whether a string begins with the given string (case sensitive).
   */
  $startsWith?: string;
  /**
   * whether a string begins with the given string (case insensitive).
   */
  $istartsWith?: string;
  /**
   * whether a string ends with the given string (case sensitive).
   */
  $endsWith?: string;
  /**
   * whether a string ends with the given string (case insensitive).
   */
  $iendsWith?: string;
  /**
   * whether a string is contained within the given string (case sensitive).
   */
  $includes?: string;
  /**
   * whether a string is contained within the given string (case insensitive).
   */
  $iincludes?: string;
  /**
   * whether a string fulfills the given pattern (case sensitive).
   */
  $like?: string;
  /**
   * whether a string fulfills the given pattern (case insensitive).
   */
  $ilike?: string;
  /**
   * whether a string matches the given regular expression.
   */
  $regex?: string;
  /**
   * whether a value matches any of the given values.
   */
  $in?: ExpandScalar<T>[];
  /**
   * whether a value does not match any of the given values.
   */
  $nin?: ExpandScalar<T>[];
};

/**
 * Value for a field comparison.
 */
export type QueryWhereFieldValue<T> = T | T[] | QueryWhereFieldOperatorMap<T> | QueryRaw;

/**
 * query single filter.
 */
export type QueryWhereSingle<E> = IdValue<E> | IdValue<E>[] | QueryWhereMap<E> | QueryRaw;

/**
 * query filter array.
 */
export type QueryWhereArray<E> = QueryWhereSingle<E>[];

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
export type QuerySortTuples<E> = [FieldKey<E>, QuerySortDirection][];

/**
 * sort by objects.
 */
export type QuerySortObjects<E> = { field: FieldKey<E>; sort: QuerySortDirection }[];

/**
 * sort by fields.
 */
export type QuerySortFieldMap<E> = {
  [K in FieldKey<E>]?: QuerySortDirection;
};

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
  [K in keyof Query<unknown>]?: string;
};

/**
 * result of an update operation.
 */
export type QueryUpdateResult = {
  /**
   * number of affected records.
   */
  changes?: number;
  /**
   * the inserted IDs.
   */
  ids?: number[] | string[];
  /**
   * first inserted ID.
   */
  firstId?: number | string;
};

/**
 * options for the `raw` function.
 */
export type QueryRawFnOptions = {
  /**
   * the current dialect.
   */
  dialect?: QueryDialect;
  /**
   * the prefix.
   */
  prefix?: string;
  /**
   * the escaped prefix.
   */
  escapedPrefix?: string;
  /**
   * the query context.
   */
  ctx?: QueryContext;
};

/**
 * a `raw` function
 */
export type QueryRawFn = (opts?: QueryRawFnOptions) => void | Scalar;

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
  usePrecedence?: boolean;
};

/**
 * query filter options.
 */
export type QueryWhereOptions = QueryComparisonOptions & {
  /**
   * clause to be used in the filter.
   */
  clause?: 'WHERE' | false;
};

export interface QueryContext {
  append(sql: string): this;
  addValue(value: unknown): this;
  pushValue(value: unknown): this;
  readonly sql: string;
  readonly values: unknown[];
}

export interface QueryDialect {
  /**
   * obtains the records matching the given search parameters.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  find<E>(ctx: QueryContext, entity: Type<E>, q: Query<E>, opts?: QueryOptions): void;

  /**
   * counts the number of records matching the given search parameters.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  count<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void;

  /**
   * insert records.
   * @param ctx the query context
   * @param entity the target entity
   * @param payload the payload
   * @param opts the query options
   */
  insert<E>(ctx: QueryContext, entity: Type<E>, payload: E | E[], opts?: QueryOptions): void;

  /**
   * update records.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param payload
   * @param opts the query options
   */
  update<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, payload: E, opts?: QueryOptions): void;

  /**
   * upsert records.
   * @param ctx the query context
   * @param entity the target entity
   * @param conflictPaths the conflict paths
   * @param payload
   */
  upsert<E>(ctx: QueryContext, entity: Type<E>, conflictPaths: QueryConflictPaths<E>, payload: E): void;

  /**
   * delete records.
   * @param ctx the query context
   * @param entity the target entity
   * @param q the criteria options
   * @param opts the query options
   */
  delete<E>(ctx: QueryContext, entity: Type<E>, q: QuerySearch<E>, opts?: QueryOptions): void;

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
  escape(val: unknown): string;

  /**
   * add a value to the query.
   * @param values the values array
   * @param value the value to add
   */
  addValue(values: unknown[], value: unknown): string;

  /**
   * create a new query context.
   */
  createContext(): QueryContext;
}

/**
 * Minimal dialect interface exposing escapeIdChar for SQL operations
 */
export interface SqlQueryDialect extends QueryDialect {
  /**
   * the escape character for identifiers.
   */
  readonly escapeIdChar: '"' | '`';

  /**
   * Get the placeholder for a parameter at the given index (1-based).
   * Default: '?' for MySQL/MariaDB/SQLite, '$n' for PostgreSQL.
   */
  placeholder(index: number): string;
}
