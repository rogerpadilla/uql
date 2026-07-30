import type { FieldOptions } from '../type/index.js';
import { escapeSingleQuotes } from '../util/sqlLiteral.js';

/**
 * Alias prefix for the derived table a dialect explodes a JSON array into to test `$all`/
 * `$elemMatch` (e.g. SQLite's `json_each(col) AS _uql_elem_1`). Passed to
 * {@link QueryContext.nextAlias} for a fresh, uniquely-numbered name per call - `$elemMatch`/`$all`
 * can recurse into this on a nested array, so a single fixed alias would let the inner occurrence
 * shadow the outer one it needs to correlate against (confirmed on SQLite and MySQL: reusing one
 * literal alias at two nesting depths silently returned zero rows instead of the matching ones).
 * Leading underscore keeps it a valid unquoted identifier on every dialect (unlike a leading `$`,
 * which Postgres/SQLite only allow after the first character) while staying an unlikely real
 * column/relation/`$select` alias name.
 */
export const JSON_ELEM_ALIAS_PREFIX = '_uql_elem';

/**
 * Alias for the derived table a dialect explodes a JSON array into to evaluate `$pull` (e.g.
 * SQLite's `json_each(col) AS _uql_pull`). Kept distinct from {@link JSON_ELEM_ALIAS_PREFIX} since
 * the two subqueries have different shapes (an `EXISTS` boolean vs. a `json_group_array` rebuild)
 * and could in principle both be in scope if this ever supports nesting one inside the other's
 * condition.
 */
export const JSON_PULL_ALIAS = '_uql_pull';

/**
 * A `'$.a.b'` JSON path literal, each dot-separated segment escaped. `suffix` appends an accessor
 * such as `[#]` or `[*]`. Shared across dialects unchanged: no dialect escapes a JSON path key
 * differently from an ANSI string literal.
 */
export function jsonPath(path: string, suffix = ''): string {
  const segments = path.split('.').map(escapeSingleQuotes).join('.');
  return `'$.${segments}${suffix}'`;
}

/**
 * `FN(target, path, value, ...)` - the multi-pair JSON assignment shape shared by MySQL's
 * `JSON_SET` and SQLite's `json_set`/`json_insert`. `pathSuffix` appends an accessor per key
 * (SQLite's `[#]` append). Values bind in key order through `bindValue`, the caller's
 * `jsonScalarParam` bound to its `QueryContext`.
 */
export function jsonAssignCall(
  bindValue: (value: unknown) => string,
  fn: string,
  target: string,
  entries: Record<string, unknown>,
  pathSuffix = '',
): string {
  const pairs = Object.entries(entries).map(([key, value]) => `${jsonPath(key, pathSuffix)}, ${bindValue(value)}`);
  return `${fn}(${target}, ${pairs.join(', ')})`;
}

/** The `$set` target: a nullable column needs a `COALESCE` fallback to build on. */
export function jsonSetTarget(expr: string, field: FieldOptions | undefined, empty: string): string {
  return field?.nullable === false ? expr : `COALESCE(${expr}, ${empty})`;
}

/**
 * `FN(expr, path, ...)` - the multi-path JSON removal shape shared by MySQL's `JSON_REMOVE` and
 * SQLite's `json_remove`, both of which take every path in a single call.
 */
export function jsonRemoveCall(fn: string, expr: string, keys: readonly string[]): string {
  return `${fn}(${expr}, ${keys.map((key) => jsonPath(key)).join(', ')})`;
}

/** `WHERE` is omitted for an empty `$elemMatch`, which asks only that the array has an element. */
export function jsonElemExists(from: string, conditions: readonly string[]): string {
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return `EXISTS (SELECT 1 FROM ${from}${where})`;
}
