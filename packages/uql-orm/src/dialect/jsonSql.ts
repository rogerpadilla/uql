import type { FieldOptions, FieldType } from '../type/index.js';
import { isBooleanType, isNumericType } from '../util/field.util.js';
import { escapeSingleQuotes } from '../util/sqlLiteral.js';

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

/**
 * How a JSON value is read out of its document: as the JSON value itself, as a number to compare
 * against, or as the text a path yields. One vocabulary for every operand of a comparison, so the
 * left side is read the way the right side is compared - see {@link jsonCompareMode}.
 */
export type JsonAccessMode = 'json' | 'numeric' | 'text';

/**
 * How a JSON scalar has to be compared against `value` (or, for `$in`/`$nin`, against every element
 * of it). Extracting a JSON value yields *text*, which loses the type, so each operand type is
 * compared in the representation every engine agrees on:
 * - `numeric` - cast the accessor. Keeps `1` equal to a stored `1.0`, which strict JSON equality
 *   would not, and satisfies drivers that send typed parameters (`text = integer` otherwise).
 * - `json` - compare the JSON value against a JSON-encoded parameter. No cast recovers a boolean
 *   portably: PostgreSQL raises `text = boolean` and MySQL matches `'true'` against `1`.
 * - `text` - compare as extracted, which is also what the string operators need.
 *
 * Mixed operand types fall back to `text`, since one comparison cannot be two shapes at once.
 */
export function jsonCompareMode(value: unknown): JsonAccessMode {
  const operands = Array.isArray(value) ? value : [value];
  if (operands.length === 0) {
    return 'text';
  }
  if (operands.every((operand) => typeof operand === 'boolean')) {
    return 'json';
  }
  return operands.every((operand) => typeof operand === 'number') ? 'numeric' : 'text';
}

/**
 * The mode a *declared* type asks for: {@link jsonCompareMode}'s twin, reading the type instead of an
 * operand. An index over a JSON path is only reachable by a comparison that extracts it the same way,
 * so the two have to answer alike - which is why they are one pair over one vocabulary.
 *
 * Reads the type through `util/field.util`'s predicates, which the dialects already carry: resolving
 * it through `schema/canonicalType` instead pulls that whole module into every consumer bundle.
 */
export function jsonTypeMode(type: FieldType): JsonAccessMode {
  if (isNumericType(type)) {
    return 'numeric';
  }
  return isBooleanType(type) ? 'json' : 'text';
}

/**
 * Whether the operator reads the JSON *value* instead of its text form. The array operators always
 * do. Equality joins them for boolean operands, because extracting JSON as text loses the type in
 * a way no cast recovers portably: PostgreSQL raises `operator does not exist: text = boolean`,
 * MySQL compares `'true'` to `1` and silently matches nothing, and SQLite's `json_extract` yields
 * `1`. Comparing the JSON value against a JSON-encoded parameter is exact on every dialect.
 *
 * Numbers stay on the text accessor with a numeric cast, which keeps `1` equal to `1.0` - JSON
 * equality would not.
 */
export function isJsonbOp(op: string, value?: unknown): boolean {
  if (op === '$all' || op === '$size' || op === '$elemMatch') {
    return true;
  }
  const comparesValue = op === '$eq' || op === '$ne' || op === '$in' || op === '$nin';
  return comparesValue && jsonCompareMode(value) === 'json';
}
