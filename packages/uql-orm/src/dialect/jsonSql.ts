import type { FieldOptions, FieldType } from '../type/index.js';
import { isOperatorMap } from '../util/dialect.util.js';
import { columnFamily } from '../util/field.util.js';
import { isOperatorKey, someKey } from '../util/object.util.js';
import { escapeSingleQuotes } from '../util/sqlLiteral.js';

/**
 * A `'$.a.b'` JSON path literal, each dot-separated segment escaped, and `'$'` for an empty path, the
 * document itself. `suffix` appends an accessor such as `[#]` or `[*]`. Shared across dialects
 * unchanged: no dialect escapes a JSON path key differently from an ANSI string literal.
 */
export function jsonPath(path: string, suffix = ''): string {
  const segments = path && `.${path.split('.').map(escapeSingleQuotes).join('.')}`;
  return `'$${segments}${suffix}'`;
}

/** A JSON value a condition reads: `path` of the JSON in `base`, `''` for all of it. */
export type JsonSlot = { readonly base: string; readonly path: string };

/** `base, '$.a.b'`, how `JSON_EACH`, `OPENJSON` and the like take the value at `slot`: no path for the whole document. */
export function jsonSlotArgs({ base, path }: JsonSlot): string {
  return path ? `${base}, ${jsonPath(path)}` : base;
}

/**
 * {@link jsonSlotArgs} reading a NULL document where `isArray` does not hold, for a function that would
 * otherwise walk a scalar, or an object's values, as if they were elements.
 */
export function jsonArraySlotArgs({ base, path }: JsonSlot, isArray: string): string {
  return jsonSlotArgs({ base: `CASE WHEN ${isArray} THEN ${base} END`, path });
}

/** How many argument groups of `size` fit in one call beside its target, under `maxArgs`. */
export function groupsPerCall(maxArgs: number, size: number): number {
  return Math.max(1, Math.floor((maxArgs - 1) / size));
}

/**
 * `fn(target, ...groups)`, nested wherever one call would take more than `maxArgs` arguments: each call
 * applies its share to what the call inside it returned, as `JSON_SET`, `JSON_REMOVE` and `json_insert`
 * do. A group, such as a path and its value, stays in one call.
 */
export function chainedCall(
  fn: string,
  target: string,
  groups: readonly string[],
  size: number,
  maxArgs: number,
): string {
  const perCall = groupsPerCall(maxArgs, size);
  let call = target;
  for (let at = 0; at < groups.length; at += perCall) {
    call = `${fn}(${call}, ${groups.slice(at, at + perCall).join(', ')})`;
  }
  return call;
}

/**
 * `JSON_SET(target, path, value, ...)`, which MySQL and SQLite share, nested past `maxArgs`. `pathSuffix`
 * appends an accessor per key (SQLite's `[#]` append). Values bind in key order through `bindValue`.
 */
export function jsonSetCall(
  bindValue: (value: unknown) => string,
  target: string,
  entries: Record<string, unknown>,
  maxArgs: number,
  pathSuffix = '',
): string {
  const pairs = Object.entries(entries).map(([key, value]) => `${jsonPath(key, pathSuffix)}, ${bindValue(value)}`);
  return chainedCall('JSON_SET', target, pairs, 2, maxArgs);
}

/** The `$set` target: a nullable column needs a `COALESCE` fallback to build on. */
export function jsonSetTarget(expr: string, field: FieldOptions | undefined, empty: string): string {
  return field?.nullable === false ? expr : `COALESCE(${expr}, ${empty})`;
}

/** `JSON_REMOVE(expr, path, ...)`, which MySQL and SQLite share, nested past `maxArgs`. */
export function jsonRemoveCall(expr: string, keys: readonly string[], maxArgs: number): string {
  return chainedCall(
    'JSON_REMOVE',
    expr,
    keys.map((key) => jsonPath(key)),
    1,
    maxArgs,
  );
}

/**
 * `WHERE` is omitted for an empty `$elemMatch`, which asks only that the array has an element. `hint` is
 * an optimizer hint the subquery opens with, if any.
 */
export function jsonElemExists(from: string, conditions: readonly string[], hint: string): string {
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return `EXISTS (SELECT ${hint && `${hint} `}1 FROM ${from}${where})`;
}

/**
 * How a JSON value is read out of its document: as the JSON value itself, as a number to compare
 * against, or as the text a path yields. One vocabulary for both sides of a comparison, so a path is
 * read the way its operand is compared - see {@link jsonCompareMode}.
 */
export type JsonAccessMode = 'json' | 'numeric' | 'text';

/**
 * How a JSON path compares for equality against `value`: `numeric` casts (so `1` equals `1.0`), `json`
 * compares JSON values (the only portable boolean), and `text` compares as extracted, also for mixed
 * operands.
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

/** The mode a declared type asks for, {@link jsonCompareMode}'s twin: an index over a path is reached only by a comparison extracting it alike. */
export function jsonTypeMode(type: FieldType): JsonAccessMode {
  const family = columnFamily(type);
  if (family === 'numeric') {
    return 'numeric';
  }
  return family === 'boolean' ? 'json' : 'text';
}

/** Whether `value` asks for more than JSON containment: an operator map anywhere in it. */
export function holdsOperator(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(holdsOperator);
  }
  return isOperatorMap(value) && someKey(value, (key) => isOperatorKey(key) || holdsOperator(value[key]));
}

/** A value an array element is matched to by JSON containment: a string, a finite number or a boolean. */
export function isJsonScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
}
