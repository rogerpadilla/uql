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

export function hasKeys(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  for (const _ in obj) return true;
  return false;
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
