import type { FieldKey, FieldOptions } from '../type/index.js';

export function clone<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((it) => clone(it)) as unknown as T;
  }
  return { ...value };
}

export function hasKeys<T>(obj: T): boolean {
  return getKeys(obj).length > 0;
}

export function getKeys<T>(obj: T): string[] {
  return obj ? Object.keys(obj) : [];
}

export function getFieldKeys<E>(
  fields: {
    [K in FieldKey<E>]?: FieldOptions;
  },
): FieldKey<E>[] {
  return getKeys(fields).filter((field) => fields[field as FieldKey<E>].eager ?? true) as FieldKey<E>[];
}
