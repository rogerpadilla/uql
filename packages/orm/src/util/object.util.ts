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

/** Whether `key` names an operator (`$eq`, `$push`...) rather than a field. */
export function isOperatorKey(key: string): boolean {
  return key.startsWith('$');
}

/** Whether `value` is a non-empty object with an operator key (`$eq`, `$push`...): the one test every dialect classifies with. */
export function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && someKey(value, isOperatorKey);
}

/** Whether `value` is an object that is not an array, whose keys can be read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getKeys<T extends object>(obj: T | null | undefined): (keyof T & string)[] {
  return obj ? (Object.keys(obj) as (keyof T & string)[]) : [];
}

/** The entries of `record` holding a value: a key declared but left `undefined` is no entry at all. */
export function definedEntries<K extends string, V>(record: Partial<Record<K, V>>): [K, V][] {
  return (Object.entries(record) as [K, V | undefined][]).filter((entry): entry is [K, V] => entry[1] !== undefined);
}

/**
 * The entity's own name, declared or its class's. `meta.name` holds only what the author wrote, so
 * the fallback is what an entity that named no table is called - which is why the sites spelling this
 * out reached for three different fallbacks, `?? ''` among them, and named nothing at all.
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
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return false;
  }
  // `null` as well as `Object.prototype`: an object with no prototype is what a query-string parser
  // hands back (`qs`, express's `req.params`), and reading one as a bare id would name one column
  // with a map of several.
  const proto = Object.getPrototypeOf(value);
  return proto !== Object.prototype && proto !== null;
}

/** Whether `value` is a plain object naming columns, the one shape a `$where` takes. */
export function isWhereMap(value: unknown): value is Record<string, unknown> {
  return !Array.isArray(value) && !isScalarId(value);
}
