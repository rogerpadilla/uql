import type { EntityMeta, FieldKey, FieldOptions } from '../type/index.js';

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

/**
 * Whether any enumerable key of `obj` satisfies `pred`, short-circuiting on the first match
 * without materializing a key array (unlike `Object.keys(obj).some(pred)`).
 */
export function someKey<T extends object>(obj: T, pred: (key: keyof T & string) => boolean): boolean {
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

/**
 * The entity's own name for a message to carry, declared or its class's. `defineEntity` always sets
 * one, so the fallback is for a meta a decorator is still building - which is why the sites spelling
 * this out reached for three different fallbacks, `?? ''` among them, and named nothing at all.
 */
export function entityName<E>(meta: EntityMeta<E>): string {
  return meta.name ?? meta.entity.name;
}

export function getFieldKeys<E>(fields: {
  [K in FieldKey<E>]?: FieldOptions;
}): FieldKey<E>[] {
  return getKeys(fields).filter((field) => fields[field]!.eager ?? true);
}

/**
 * Whether `value` addresses a row by itself rather than naming columns: every primitive, and the
 * object ids a driver deals in (`ObjectId`, `Date`, bytes). Only a plain object names columns, which
 * is what a `$where` map and a composite key's id object both are; an array is a list of either.
 */
export function isScalarId(value: unknown): boolean {
  return (
    typeof value !== 'object' ||
    value === null ||
    (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
  );
}
