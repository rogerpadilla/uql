import type { FieldValue, Key } from '../type/index.js';
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
      // Support both dot notation (legacy) and underscore notation (new)
      if (col.includes('.')) {
        acc[col] = col.split('.');
      } else if (col.includes('_') && col !== col.toUpperCase()) {
        // Convert underscore to dot notation for nested paths
        // Skip all-uppercase (like UPPER_CASE constants)
        acc[col] = col.split('_');
      }
      return acc;
    },
    {} as { [k: string]: string[] },
  );
}

/**
 * Escape a SQL identifier (table name, column name, etc.)
 * @param val the identifier to escape
 * @param escapeIdChar the escape character to use (e.g. ` or ")
 * @param forbidQualified whether to forbid qualified identifiers (containing dots)
 * @param addDot whether to add a dot suffix
 */
export function escapeSqlId(
  val: string,
  escapeIdChar: '`' | '"' = '`',
  forbidQualified?: boolean,
  addDot?: boolean,
): string {
  if (!val) {
    return '';
  }

  if (!forbidQualified && val.includes('.')) {
    const result = val
      .split('.')
      .map((it) => escapeSqlId(it, escapeIdChar, true))
      .join('.');
    return addDot ? result + '.' : result;
  }

  const escaped = escapeIdChar + val.replace(new RegExp(escapeIdChar, 'g'), escapeIdChar + escapeIdChar) + escapeIdChar;

  const suffix = addDot ? '.' : '';

  return escaped + suffix;
}
