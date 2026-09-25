import {
  type QueryCompareOp,
  type QueryGroupOp,
  type QueryJoinOp,
  type QueryLikeOp,
  type QueryOrderedOp,
  type QueryVectorNear,
  type QueryVectorQuery,
  QueryRaw,
  type QueryWhere,
  type QueryWhereArray,
  type QueryWhereFieldOp,
  VECTOR_QUERY_KEYS,
} from '../type/index.js';
import { isOperatorMap } from '../util/dialect.util.js';
import { hasKeys, isWhereMap, someKey } from '../util/object.util.js';
import { kindOf, UqlUsageError } from '../util/uqlError.js';

/**
 * How each grouping operator renders: the operator joining its clauses, and whether the group is
 * negated (`$not` is `NOT (a AND b)`). Total over {@link QueryGroupOp}.
 */
export const GROUP_OPS = {
  $and: { join: '$and', negate: false },
  $or: { join: '$or', negate: false },
  $not: { join: '$and', negate: true },
  $nor: { join: '$or', negate: true },
} as const satisfies Record<QueryGroupOp, { readonly join: QueryJoinOp; readonly negate: boolean }>;

/** Whether a `$where` key groups clauses, narrowing it for the renderers that read {@link GROUP_OPS}. */
export function isGroupOp(key: string): key is QueryGroupOp {
  return Object.hasOwn(GROUP_OPS, key);
}

/**
 * A group operator's clauses, rejecting what the types do not cover: `/http` casts client JSON
 * straight to `Query`, so a scalar can arrive where an array belongs. Shared so both backends
 * refuse the same payload rather than one throwing and the other failing further in.
 */
export function groupClauses<E>(key: QueryGroupOp, val: QueryWhereArray<E> | undefined): QueryWhereArray<E> {
  if (val !== undefined && !Array.isArray(val)) {
    throw new UqlUsageError(`${key} expects an array, got ${kindOf(val)}`);
  }
  return val ?? [];
}

/**
 * Whether a `$where` names any rows, as the WHERE it renders would: an `undefined` value, an empty
 * operator map and a group none of whose clauses names one all render nothing, which a write reads as
 * the whole table.
 */
export function namesRows<E>(where: QueryWhere<E> | undefined): boolean {
  return (
    where !== undefined &&
    someKey(where, (key) =>
      isGroupOp(key)
        ? groupClauses(key, where[key]).some((clause) => clause instanceof QueryRaw || namesRows(clause))
        : where[key] !== undefined && !(isWhereMap(where[key]) && !hasKeys(where[key])),
    )
  );
}

/**
 * A WHERE value as the operators it applies: an array is `$in`, an operator map its own entries, and
 * anything else `$eq`. Each key is checked here, once, refused as `refusal` where it is no operator.
 */
export function whereOperators(val: unknown, refusal: string): [QueryWhereFieldOp, unknown][] {
  const ops = Array.isArray(val) ? { $in: val } : isOperatorMap(val) ? val : { $eq: val };
  return Object.entries(ops).map(([op, value]) => {
    if (!isFieldOp(op)) {
      throw new UqlUsageError(`${refusal}: ${op}`);
    }
    return [op, value];
  });
}

/** An `$in`/`$nin` operand, which the types require to be an array but `/http` hands over untyped. */
export function inOperands(op: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new UqlUsageError(`${op} expects an array, got ${kindOf(value)}`);
  }
  return value;
}

/** A `$between`'s two bounds, which `/http` hands over untyped too; one missing would bind `undefined`. */
export function betweenBounds(value: unknown): readonly [unknown, unknown] {
  if (!Array.isArray(value) || value.length !== 2) {
    const got = Array.isArray(value) ? `${value.length} values` : kindOf(value);
    throw new UqlUsageError(`$between expects [min, max], got ${got}`);
  }
  const [min, max] = value;
  return [min, max];
}

/**
 * Every field operator as data, which is what checks a key `/http` hands over; `satisfies` fails the
 * build on one {@link QueryWhereFieldOp} gains and this misses.
 */
const FIELD_OPS = {
  $eq: true,
  $ne: true,
  $not: true,
  $lt: true,
  $lte: true,
  $gt: true,
  $gte: true,
  $between: true,
  $startsWith: true,
  $istartsWith: true,
  $endsWith: true,
  $iendsWith: true,
  $includes: true,
  $iincludes: true,
  $like: true,
  $ilike: true,
  $regex: true,
  $in: true,
  $nin: true,
  $isNull: true,
  $isNotNull: true,
  $all: true,
  $size: true,
  $elemMatch: true,
  $near: true,
} as const satisfies Record<QueryWhereFieldOp, true>;

function isFieldOp(op: string): op is QueryWhereFieldOp {
  return Object.hasOwn(FIELD_OPS, op);
}

/** Whether a `$near` names the vector it measures from, which its type requires and `/http` does not. */
export function isVectorQuery(near: Record<string, unknown>): near is Record<string, unknown> & QueryVectorQuery {
  return Boolean(near['$vector']);
}

/** One entry of {@link LIKE_OPS}: how the pattern is built, and whether it ignores case. */
export type LikeOp = { readonly pattern: (value: string) => string; readonly insensitive: boolean };

export const COMPARE_OPS: ReadonlyMap<QueryWhereFieldOp, string> = new Map<QueryCompareOp, string>([
  ['$gt', ' > '],
  ['$gte', ' >= '],
  ['$lt', ' < '],
  ['$lte', ' <= '],
]);

/**
 * The ordered comparisons, `QueryOrderedOp` at runtime, derived from {@link COMPARE_OPS} rather than spelled
 * again: {@link QueryVectorNear}'s bounds, so `$near` never accepts one the renderer has no operator
 * for, and the operators that read a JSON path as a number.
 */
export const ORDERED_OPS: ReadonlySet<string> = new Set<string>([...COMPARE_OPS.keys(), '$between']);

export function isOrderedOp(op: string): op is QueryOrderedOp {
  return ORDERED_OPS.has(op);
}

/** The operators an equality compares by value, which a JSON path reads the way that value compares. */
export const EQUALITY_OPS: ReadonlySet<string> = new Set<string>(['$eq', '$ne', '$in', '$nin']);

/**
 * `value` as a `$like` pattern matching it literally. The pattern language is the same on every engine:
 * `%` and `_` are wildcards, `\` escapes, and `[` is escaped since SQL Server reads it as a character class.
 */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_[]/g, '\\$&');
}

/**
 * `pattern` with its `[` escaped, as {@link likeLiteral} does; refused where its last `\` has nothing
 * after it to escape (`'John\'`): Postgres throws on one, MySQL reads it literally and SQLite matches nothing.
 */
export function likePattern(pattern: string): string {
  const tokens = likeTokens(pattern);
  const last = tokens.at(-1);
  if (last?.char === '\\' && !last.escaped) {
    throw new UqlUsageError(
      "a $like pattern cannot end in a '\\' with nothing after it to escape: write '\\\\' to match a backslash",
    );
  }
  return tokens.map(({ char, escaped }) => (escaped || char === '[' ? `\\${char}` : char)).join('');
}

/**
 * A `$like` pattern as the anchored regex matching the same strings, for an engine with no `LIKE`. A
 * wildcard spans lines, as it does in SQL; an edge `%` drops its anchor, which keeps a prefix indexable.
 * The end anchor is `\z`, since `$` also matches before a trailing newline.
 */
export function likeRegex(pattern: string): string {
  const tokens = likeTokens(pattern).map(
    ({ char, escaped }) => (escaped ? undefined : LIKE_WILDCARDS[char]) ?? escapeRegex(char),
  );
  const open = tokens[0] === LIKE_WILDCARDS['%'];
  const closed = tokens.at(-1) !== LIKE_WILDCARDS['%'];
  const body = tokens.slice(open ? 1 : 0, closed ? undefined : -1).join('');
  return `${open ? '' : '^'}${body}${closed ? String.raw`\z` : ''}`;
}

/** A `$like` pattern's characters, each marked where a `\` escaped it; a last `\` escaping nothing reads as plain. */
function likeTokens(pattern: string): { readonly char: string; readonly escaped: boolean }[] {
  return [...pattern.matchAll(/\\([\s\S])|[\s\S]/g)].map(([token, escaped]) => ({
    char: escaped ?? token,
    escaped: escaped !== undefined,
  }));
}

/** Each `$like` wildcard as the regex matching it, across lines as SQL does. */
const LIKE_WILDCARDS: Readonly<Record<string, string>> = { '%': String.raw`[\s\S]*`, _: String.raw`[\s\S]` };

function escapeRegex(char: string): string {
  return char.replace(/[\\^$.*+?()[\]{}|]/, '\\$&');
}

/**
 * Every `$like`-family operator: the pattern it wraps its value in, and whether it ignores case.
 * Each case-sensitive operator is paired here with the `$i` twin that shares its pattern, so the
 * two can never drift apart - and neither one decides case folding, which is
 * `AbstractSqlDialect.caseInsensitiveMatch`'s single call.
 */
export const LIKE_OPS: ReadonlyMap<string, LikeOp> = new Map(
  (
    [
      ['$like', '$ilike', likePattern],
      ['$startsWith', '$istartsWith', (v: string) => `${likeLiteral(v)}%`],
      ['$endsWith', '$iendsWith', (v: string) => `%${likeLiteral(v)}`],
      ['$includes', '$iincludes', (v: string) => `%${likeLiteral(v)}%`],
    ] satisfies readonly [QueryLikeOp, QueryLikeOp, (v: string) => string][]
  ).flatMap(([sensitive, insensitive, pattern]): [string, LikeOp][] => [
    [sensitive, { pattern, insensitive: false }],
    [insensitive, { pattern, insensitive: true }],
  ]),
);

/** What a `$near` says about the search itself; everything else in it is a bound. */
export const VECTOR_QUERY_KEY_SET: ReadonlySet<string> = new Set<string>(VECTOR_QUERY_KEYS);
