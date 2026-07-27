import type { FieldKey, FieldOptions } from '../type/index.js';

export function throwPendingTransaction(): never {
  throw TypeError('pending transaction');
}

export function throwNoPendingTransaction(): never {
  throw TypeError('not a pending transaction');
}

export function clone<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((it) => clone(it)) as T;
  }
  return { ...value };
}

/** Whether `obj` has at least one enumerable key. Narrows away `undefined`/`null` for callers. */
export function hasKeys<T>(obj: T): obj is NonNullable<T> {
  if (typeof obj !== 'object' || obj === null) return false;
  for (const _ in obj) return true;
  return false;
}

/** Whether `obj` has at least two enumerable keys. */
export function hasMultipleKeys(obj: object): boolean {
  let count = 0;
  for (const _ in obj) {
    if (++count > 1) return true;
  }
  return false;
}

/**
 * Whether any enumerable key of `obj` satisfies `pred`, short-circuiting on the first match
 * without materializing a key array (unlike `Object.keys(obj).some(pred)`).
 */
export function someKey(obj: object, pred: (key: string) => boolean): boolean {
  for (const key in obj) {
    if (pred(key)) return true;
  }
  return false;
}

/** Whether any enumerable value of `obj` satisfies `pred`, short-circuiting like {@link someKey}. */
export function someValue(obj: object, pred: (value: unknown) => boolean): boolean {
  return someKey(obj, (key) => pred((obj as Record<string, unknown>)[key]));
}

const isOperatorKey = (key: string) => key.startsWith('$');

/**
 * Whether `value` is a non-empty object whose keys are query/update operators (`$eq`, `$push`, ...).
 * The single source of this test: the SQL dialects, the MongoDB dialect and the `$elemMatch` walker
 * all classify operator objects with it, and they used to disagree about `{}`.
 */
export function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return hasKeys(value) && !Array.isArray(value) && someKey(value, isOperatorKey);
}

/** Whether every key of the non-empty object `value` is an operator (no plain field names mixed in). */
export function isOperatorOnlyObject(value: unknown): value is Record<string, unknown> {
  return hasKeys(value) && !Array.isArray(value) && !someKey(value, (key) => !isOperatorKey(key));
}

export function getKeys<T extends object>(obj: T): (keyof T & string)[] {
  return obj ? (Object.keys(obj) as (keyof T & string)[]) : [];
}

export function getFieldKeys<E>(
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  },
): FieldKey<E>[] {
  return getKeys(fields).filter((field) => fields[field]!.eager ?? true);
}
