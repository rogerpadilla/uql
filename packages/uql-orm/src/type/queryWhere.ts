import type { FieldKey, IdValue, JsonFieldPaths, JsonFieldPathValue, RelationKey } from './entity.js';
import type { QueryRaw } from './queryRaw.js';
import type { ExpandScalar, QueryComparableScalar, Scalar, Unpacked } from './utility.js';

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
  /**
   * Postgres text-search configuration (e.g. `'english'`), applied to both the document and the
   * query. Defaults to the server's `default_text_search_config`. Ignored by other dialects.
   */
  $config?: string;
};

/**
 * comparison by fields.
 */
export type QueryWhereFieldMap<E> = { [K in FieldKey<E>]?: QueryWhereFieldValue<E[K]> };

/**
 * Field comparison, JSON dot-path access, and relation filtering - all fully typed.
 * JSON dot-paths are restricted to real JSON fields, and typed payloads type each path's value
 * (untyped `Json` payloads accept any `field.suffix` path with a permissive value). Relations are
 * filtered via nested typed objects; dotted relation paths are not supported (the dialects throw
 * for non-JSON dotted keys).
 */
export type QueryWhereMap<E> = QueryWhereFieldMap<E> &
  QueryWhereRootOperator<E> & {
    [P in JsonFieldPaths<E>]?: QueryWhereFieldValue<JsonFieldPathValue<E, P>>;
  } & { [K in RelationKey<E>]?: QueryWhereMap<Unpacked<NonNullable<E[K]>>> | QueryRelationSizeFilter };

/**
 * Filter a to-many relation by its row count.
 * @example { users: { $size: 2 } }
 * @example { users: { $size: { $gte: 2 } } }
 */
export type QueryRelationSizeFilter = {
  readonly $size: number | QuerySizeComparisonOps;
};

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
   * @see {@link QueryWhereFieldOperatorMap.$not} for per-field negation.
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

/**
 * Per-field negation operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereRootOperator} so a rename there breaks this union at compile time.
 */
export type QueryNegateOp = keyof Pick<QueryWhereRootOperator<unknown>, '$not' | '$nor'>;

/**
 * Comparison operators accepted by `$size` for range queries: {@link QueryHavingOp} plus `$between`.
 * Strips `null` from picked operators since array size is always numeric.
 */
export type QuerySizeComparisonOps = {
  [K in QueryHavingOp | '$between']?: NonNullable<QueryWhereFieldOperatorMap<number>[K]>;
};

export type QueryWhereFieldOperatorMap<T> = {
  /**
   * whether a value is equal to the given value.
   */
  $eq?: ExpandScalar<T> | null;
  /**
   * whether a value is not equal to the given value.
   */
  $ne?: ExpandScalar<T> | null;
  /**
   * negates the given comparison for a single field.
   * @see {@link QueryWhereRootOperator.$not} for root-level clause negation.
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
   * whether a value is between two values (inclusive). Shorthand for $gte + $lte.
   * @example { age: { $between: [18, 65] } }
   */
  $between?: [ExpandScalar<T>, ExpandScalar<T>];
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
  /**
   * whether a value is null.
   * @example { deletedAt: { $isNull: true } }
   */
  $isNull?: boolean;
  /**
   * whether a value is not null.
   * @example { email: { $isNotNull: true } }
   */
  $isNotNull?: boolean;
  /**
   * whether an array contains all the specified values.
   * @example { tags: { $all: ['typescript', 'orm'] } }
   */
  $all?: unknown extends T ? unknown[] : NonNullable<T> extends readonly (infer U)[] ? ExpandScalar<U>[] : never;
  /**
   * whether an array has the specified length.
   * Accepts a number for exact match, or a comparison operator object for range queries.
   * @example { roles: { $size: 3 } }
   * @example { roles: { $size: { $gte: 2 } } }
   * @example { roles: { $size: { $gt: 0, $lte: 5 } } }
   */
  $size?: number | QuerySizeComparisonOps;
  /**
   * whether an array contains at least one element matching all specified conditions.
   * Each key of the element type maps to a value or an operator map for that key.
   * @example { addresses: { $elemMatch: { city: 'NYC', zip: '10001' } } }
   * @example { addresses: { $elemMatch: { city: { $like: 'New%' } } } }
   */
  $elemMatch?: unknown extends T
    ? QueryWhereElemMatch<unknown>
    : NonNullable<T> extends readonly (infer U)[]
      ? QueryWhereElemMatch<U>
      : never;
};

/**
 * Element-level conditions for `$elemMatch`. Scalar elements take an operator map for the element
 * itself (`{ tags: { $elemMatch: { $startsWith: 'ad' } } }`); object elements map each key to a
 * field comparison. An untyped element (`unknown`) accepts any keys but still requires the
 * object-of-conditions shape (a bare scalar is rejected).
 */
export type QueryWhereElemMatch<U> = unknown extends U
  ? { [key: string]: QueryWhereFieldValue<unknown> | undefined }
  : NonNullable<U> extends Scalar
    ? QueryWhereFieldOperators<NonNullable<U>>
    : { [K in keyof NonNullable<U>]?: QueryWhereFieldValue<NonNullable<U>[K]> };

/**
 * Simple relational comparison operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
export type QueryCompareOp = keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$gt' | '$gte' | '$lt' | '$lte'>;

/**
 * String pattern-matching operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
export type QueryLikeOp = keyof Pick<
  QueryWhereFieldOperatorMap<unknown>,
  '$startsWith' | '$istartsWith' | '$endsWith' | '$iendsWith' | '$includes' | '$iincludes' | '$like' | '$ilike'
>;

/**
 * `HAVING` clause operators: {@link QueryCompareOp} plus `$eq`/`$ne`. `Pick`'s constraint ties the
 * latter back to {@link QueryWhereFieldOperatorMap} so a rename there breaks this union at compile time.
 */
export type QueryHavingOp = QueryCompareOp | keyof Pick<QueryWhereFieldOperatorMap<number>, '$eq' | '$ne'>;

/**
 * String pattern-matching operators: {@link QueryLikeOp} plus `$regex`. `Pick`'s constraint ties
 * the latter back to {@link QueryWhereFieldOperatorMap} so a rename there breaks this union.
 */
type QueryStringOp = QueryLikeOp | keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$regex'>;

/**
 * Array-only operators. `Pick`'s constraint ties this back to {@link QueryWhereFieldOperatorMap}
 * so a rename there breaks this union at compile time.
 */
type QueryArrayOp = keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$all' | '$size' | '$elemMatch'>;

/**
 * Ordering operators: {@link QueryCompareOp} plus `$between`.
 */
type QueryOrderedOp = QueryCompareOp | keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$between'>;

/**
 * Operators applicable to every field type: equality, membership, negation, and null checks.
 */
type QueryCommonOp = Exclude<keyof QueryWhereFieldOperatorMap<unknown>, QueryStringOp | QueryArrayOp | QueryOrderedOp>;

/**
 * Operator keys applicable to a field of type `T`. Brackets prevent union distribution so an
 * optional field (`string | undefined`) or a literal union (`'a' | 'b'`) gates as one type.
 */
type QueryAllowedOp<T> =
  | QueryCommonOp
  | ([NonNullable<T>] extends [QueryComparableScalar] ? QueryOrderedOp : never)
  | ([NonNullable<T>] extends [string] ? QueryStringOp : never)
  | ([NonNullable<T>] extends [readonly unknown[]] ? QueryArrayOp : never);

/**
 * Operators applicable to a field of type `T`: string operators require string fields, ordering
 * operators comparable fields, array operators array fields. `unknown` stays fully permissive
 * (untyped JSON dot-paths, erased dialect shapes).
 */
export type QueryWhereFieldOperators<T> = unknown extends T
  ? QueryWhereFieldOperatorMap<T>
  : Pick<QueryWhereFieldOperatorMap<T>, QueryAllowedOp<T>>;

/**
 * Value for a field comparison. A bare array is an implicit `$in` for scalar fields only:
 * on array-typed fields (e.g. a vector `number[]`) an array of arrays is ambiguous, so
 * membership there requires an explicit operator.
 */
export type QueryWhereFieldValue<T> =
  | T
  | ([NonNullable<T>] extends [readonly unknown[]] ? never : T[])
  | QueryWhereFieldOperators<T>
  | QueryRaw;

/**
 * query filter array - used for `$and`, `$or`, `$not`, `$nor` operators.
 */
export type QueryWhereArray<E> = (QueryWhereMap<E> | QueryRaw)[];

/**
 * query filter.
 */
export type QueryWhere<E> = IdValue<E> | IdValue<E>[] | QueryWhereMap<E> | QueryWhereArray<E> | QueryRaw;
