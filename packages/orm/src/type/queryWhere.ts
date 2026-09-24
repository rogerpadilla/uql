import type { FieldKey, JsonFieldPaths, JsonFieldPathValue, RelationKey, RelationTarget } from './entity.js';
import type { QuerySelect } from './query.js';
import type { QueryRaw, RawFor } from './queryRaw.js';
import type { AtLeastOne, ExpandScalar, IsMany, QueryComparableScalar, Scalar } from './utility.js';
import type { QueryVectorQuery } from './vector.js';

/**
 * options for full-text-search operator.
 */
export type QueryTextSearchOptions<E> = {
  /**
   * text to search for.
   */
  $value: string;
  /**
   * the fields to search, `{ title: true, body: true }`, in the order a MySQL `FULLTEXT` index lists them.
   */
  $fields?: QuerySelect<E>;
  /**
   * The language the search is parsed in (e.g. `'english'`, or `'simple'` for no stemming), else that of
   * the fulltext index over its fields: the Postgres family's text-search config, MongoDB's `$language`.
   * MySQL and SQLite parse by their index alone.
   */
  $config?: string;
};

/**
 * A filter by fields, JSON paths (typed by their payload) and relations, one mapped type over the
 * entity's keys so each stays linked for rename. An object and nothing else, so a wrong value is
 * reported on its key: ids go through `{ id: 1 }` or the by-id methods.
 */
export type QueryWhere<E, Raw = QueryRaw, K extends keyof E = FieldKey<E> | RelationKey<E>> = QueryWhereRootOperator<
  E,
  Raw
> & {
  [P in K]?: P extends FieldKey<E>
    ? QueryWhereFieldValue<E[P], Raw>
    : QueryWhere<RelationTarget<E[P]>, Raw> | QueryRelationSizeFilter;
} & ([JsonFieldPaths<E>] extends [never]
    ? unknown
    : { [P in JsonFieldPaths<E>]?: QueryWhereFieldValue<JsonFieldPathValue<E, P>, Raw> });

/**
 * Filter a to-many relation by its row count.
 * @example { users: { $size: 2 } }
 * @example { users: { $size: { $gte: 2 } } }
 */
export type QueryRelationSizeFilter = {
  readonly $size: number | QuerySizeComparisonOps;
};

export type QueryWhereRootOperator<E, Raw = QueryRaw> = {
  /**
   * joins query clauses with a logical `AND`, returns records that match all the clauses.
   */
  $and?: QueryWhereArray<E, Raw>;
  /**
   * joins query clauses with a logical `OR`, returns records that match any of the clauses.
   */
  $or?: QueryWhereArray<E, Raw>;
  /**
   * joins query clauses with a logical `AND`, returns records that do not match all the clauses.
   * @see {@link QueryWhereFieldOperatorMap.$not} for per-field negation.
   */
  $not?: QueryWhereArray<E, Raw>;
  /**
   * joins query clauses with a logical `OR`, returns records that do not match any of the clauses.
   */
  $nor?: QueryWhereArray<E, Raw>;
  /**
   * whether the specified fields match against a full-text search of the given string.
   */
  $text?: QueryTextSearchOptions<E>;
  /**
   * whether the record exists in the given sub-query.
   */
  $exists?: Raw;
  /**
   * whether the record does not exists in the given sub-query.
   */
  $nexists?: Raw;
};

/**
 * Per-field negation operators. `Pick`'s constraint ties this back to
 * {@link QueryWhereRootOperator} so a rename there breaks this union at compile time.
 */
export type QueryNegateOp = keyof Pick<QueryWhereRootOperator<unknown>, '$not' | '$nor'>;

/**
 * The root operators that join their clauses instead of negating them, tied back to
 * {@link QueryWhereRootOperator} on the same terms as {@link QueryNegateOp}.
 */
export type QueryJoinOp = keyof Pick<QueryWhereRootOperator<unknown>, '$and' | '$or'>;

/**
 * Every root operator whose value is a {@link QueryWhereArray} rather than a field condition: the
 * two that join their clauses and the two that negate the join.
 */
export type QueryGroupOp = QueryJoinOp | QueryNegateOp;

/**
 * Comparison operators accepted by `$size` for range queries: {@link QueryHavingOp} plus `$between`.
 * Strips `null` from picked operators since array size is always numeric.
 */
export type QuerySizeComparisonOps = {
  [K in QueryHavingOp | '$between']?: NonNullable<QueryWhereFieldOperatorMap<number>[K]>;
};

/**
 * Filter by distance to a vector, `{ $near: { $vector: v, $lt: 0.35 } }`: ordered bounds only, since a
 * distance is a float, and at least one, since none would filter nothing. Each clause names its own
 * `$vector`, and `$distance` falls back to the field's. `/http` input is untyped, so the dialect
 * checks it again at run time.
 */
export type QueryVectorNear = QueryVectorQuery &
  AtLeastOne<{ [K in QueryOrderedOp]: NonNullable<QueryWhereFieldOperatorMap<number>[K]> }>;

export type QueryWhereFieldOperatorMap<T, Raw = QueryRaw> = {
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
  $not?: QueryWhereFieldValue<T, Raw>;
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
  $between?: readonly [ExpandScalar<T>, ExpandScalar<T>];
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
  $in?: readonly ExpandScalar<T>[];
  /**
   * whether a value does not match any of the given values.
   */
  $nin?: readonly ExpandScalar<T>[];
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
  $all?: unknown extends T
    ? readonly unknown[]
    : NonNullable<T> extends readonly (infer U)[]
      ? readonly ExpandScalar<U>[]
      : never;
  /** whether an array has the given length, or one in range: `{ roles: { $size: { $gte: 2 } } }`. */
  $size?: number | QuerySizeComparisonOps;
  /**
   * whether an array contains at least one element matching all specified conditions.
   * Each key of the element type maps to a value or an operator map for that key.
   * @example { addresses: { $elemMatch: { city: 'NYC', zip: '10001' } } }
   * @example { addresses: { $elemMatch: { city: { $like: 'New%' } } } }
   */
  $elemMatch?: unknown extends T
    ? QueryWhereElemMatch<unknown, Raw>
    : NonNullable<T> extends readonly (infer U)[]
      ? QueryWhereElemMatch<U, Raw>
      : never;
  /**
   * whether a vector is within a given distance of the query vector. `$sort` ranks by distance;
   * this filters by it, so "the closest ten" and "everything closer than 0.35" are separate asks.
   * @example { embedding: { $near: { $vector: queryVec, $lt: 0.35 } } }
   */
  $near?: QueryVectorNear;
};

/**
 * Element-level conditions for `$elemMatch`. Scalar elements take an operator map for the element
 * itself (`{ tags: { $elemMatch: { $startsWith: 'ad' } } }`); object elements map each key to a
 * field comparison. An untyped element (`unknown`) accepts any keys but still requires the
 * object-of-conditions shape (a bare scalar is rejected).
 */
export type QueryWhereElemMatch<U, Raw = QueryRaw> = unknown extends U
  ? { [key: string]: QueryWhereFieldValue<unknown, Raw> | undefined }
  : NonNullable<U> extends Scalar
    ? QueryWhereFieldOperators<NonNullable<U>, Raw>
    : { [K in keyof NonNullable<U>]?: QueryWhereFieldValue<NonNullable<U>[K], Raw> };

/** Every operator a field condition takes, which is what a key of one is once checked. */
export type QueryWhereFieldOp = keyof QueryWhereFieldOperatorMap<unknown>;

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
export type QueryOrderedOp = QueryCompareOp | keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$between'>;

/**
 * Vector-only operators. `Pick`'s constraint ties this back to {@link QueryWhereFieldOperatorMap}
 * so a rename there breaks this union at compile time.
 */
type QueryVectorOp = keyof Pick<QueryWhereFieldOperatorMap<unknown>, '$near'>;

/**
 * The operators every field takes. A subtraction, so an operator added to the map without being
 * classified above is offered on every field: classify it first.
 */
type QueryCommonOp = Exclude<QueryWhereFieldOp, QueryStringOp | QueryArrayOp | QueryOrderedOp | QueryVectorOp>;

/**
 * Operator keys applicable to a field of type `T`. Brackets prevent union distribution so an
 * optional field (`string | undefined`) or a literal union (`'a' | 'b'`) gates as one type.
 */
type QueryAllowedOp<T> =
  | QueryCommonOp
  | ([NonNullable<T>] extends [QueryComparableScalar] ? QueryOrderedOp : never)
  | ([NonNullable<T>] extends [string] ? QueryStringOp : never)
  | ([NonNullable<T>] extends [readonly number[] | Uint8Array] ? QueryVectorOp : never)
  | (IsMany<T> extends true ? QueryArrayOp : never);

/**
 * The operators a field of type `T` takes. `unknown`, and a column typed as every scalar at once (a
 * runtime-defined entity), take all of them, since nothing narrows what they hold.
 */
export type QueryWhereFieldOperators<T, Raw = QueryRaw> = unknown extends T
  ? QueryWhereFieldOperatorMap<T, Raw>
  : IsUntypedColumn<T> extends true
    ? QueryWhereFieldOperatorMap<T, Raw>
    : Pick<QueryWhereFieldOperatorMap<T, Raw>, QueryAllowedOp<T>>;

/**
 * Whether a column admits every scalar at once, which is what an entity keyed by an index signature
 * says about all of its columns. `Scalar` is the yardstick rather than a parameter: the question is
 * whether `T` is at least that wide, and nothing narrower than the whole union answers it.
 */
type IsUntypedColumn<T> = [Scalar] extends [NonNullable<T>] ? true : false;

/**
 * A field's filter value: the value, `null` where it is optional, a list as an implicit `$in` (not on
 * an array field, where it would be ambiguous), or an operator map.
 */
export type QueryWhereFieldValue<T, Raw = QueryRaw> =
  | T
  | (undefined extends T ? null : never)
  | (IsMany<T> extends true ? never : readonly T[])
  | QueryWhereFieldOperators<T, Raw>
  | RawFor<Raw, T>;

/**
 * query filter array - the value every {@link QueryGroupOp} takes.
 */
export type QueryWhereArray<E, Raw = QueryRaw> = readonly (QueryWhere<E, Raw> | Raw)[];
