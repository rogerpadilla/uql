import { MapView } from './types.js';

export const EMPTY_OBJECT = Object.freeze(Object.create(null));

export const EMPTY_ARRAY = Object.freeze([]);

export function isObject(data: any): data is object {
  return data && typeof data === 'object';
}

/**
 * Works like lodash's isPlainObject, but has better typings
 *
 * @param value The value to check
 */
export function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === null || prototype === Object.prototype;
}

export function isString(data: any): data is string {
  return typeof data === 'string' || data instanceof String;
}

export function getObjectFromMap<K extends PropertyKey, V>(aMap: Map<K, V> | MapView<K, V>): Record<K, V> {
  const record = Object.create(null);

  for (const key of aMap.keys()) {
    record[key] = aMap.get(key);
  }

  return record;
}
