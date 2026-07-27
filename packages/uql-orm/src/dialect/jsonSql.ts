import type { FieldOptions } from '../type/index.js';
import { escapeSingleQuotes } from '../util/ansiSqlLiteral.js';

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
