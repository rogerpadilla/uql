import type { FieldValue, Key } from 'nukak/type';
import { getKeys, hasKeys } from './object.util.js';

export function flatObject<E>(obj: E, pre?: string): E {
  return getKeys(obj).reduce(
    (acc, key) => flatObjectEntry(acc, key, obj[key as Key<E>], typeof obj[key as Key<E>] === 'object' ? '' : pre),
    {} as E,
  );
}

function flatObjectEntry<E>(map: E, key: string, val: any, pre?: string): E {
  const prefix = pre ? `${pre}.${key}` : key;
  return typeof val === 'object'
    ? getKeys(val).reduce((acc, prop) => flatObjectEntry(acc, prop, val[prop], prefix), map)
    : { ...map, [prefix]: val };
}

export function unflatObjects<T>(objects: T[]): T[] {
  if (!Array.isArray(objects) || !objects.length) {
    return objects;
  }

  const attrsPaths = obtainAttrsPaths(objects[0]);

  if (!hasKeys(attrsPaths)) {
    return objects;
  }

  return objects.map((row) => {
    const dto = {} as T;

    for (const col in row) {
      if (row[col] === null) {
        continue;
      }
      const attrPath = attrsPaths[col];
      if (attrPath) {
        const target = attrPath.slice(0, -1).reduce(
          (acc, key) => {
            if (typeof acc[key as Key<T>] !== 'object') {
              acc[key as Key<T>] = {} as FieldValue<T>;
            }
            return acc[key as Key<T>];
          },
          dto as Record<string, any>,
        );
        target[attrPath[attrPath.length - 1]] = row[col];
      } else {
        dto[col] = row[col];
      }
    }

    return dto;
  });
}

export function obtainAttrsPaths<T>(row: T) {
  return getKeys(row).reduce(
    (acc, col) => {
      if (col.includes('.')) {
        acc[col] = col.split('.');
      }
      return acc;
    },
    {} as { [k: string]: string[] },
  );
}
