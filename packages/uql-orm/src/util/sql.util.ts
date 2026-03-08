import type { Key, QueryUpdateResult, RawRow } from '../type/index.js';
import { getKeys, hasKeys } from './object.util.js';

/** Pre-computed regex for each SQL identifier escape character to avoid per-call allocation. */
const escapeIdRegexCache = { '`': /`/g, '"': /"/g } as const satisfies Record<string, RegExp>;

export function flatObject<E extends object>(obj: E, pre?: string): E {
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

export function unflatObjects<T extends object>(objects: RawRow[]): T[] {
  if (!Array.isArray(objects) || !objects.length) {
    return objects as T[];
  }

  const attrsPaths = obtainAttrsPaths(objects[0]);

  if (!hasKeys(attrsPaths)) {
    return objects as T[];
  }

  return objects.map((row) => {
    const dto = {} as T;

    for (const col in row) {
      if (row[col] === null) {
        continue;
      }
      const attrPath = attrsPaths[col];
      if (attrPath) {
        let target = dto as Record<string, unknown>;
        for (let i = 0; i < attrPath.length - 1; i++) {
          const seg = attrPath[i];
          if (typeof target[seg] !== 'object') {
            target[seg] = {};
          }
          target = target[seg] as Record<string, unknown>;
        }
        target[attrPath[attrPath.length - 1]] = row[col];
      } else {
        (dto as RawRow)[col] = row[col];
      }
    }

    return dto;
  });
}

export function obtainAttrsPaths<T extends object>(row: T) {
  const paths: { [k: string]: string[] } = {};
  for (const col in row) {
    if (col.includes('.')) {
      paths[col] = col.split('.');
    }
  }
  return paths;
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

  const escaped =
    escapeIdChar + val.replace(escapeIdRegexCache[escapeIdChar], escapeIdChar + escapeIdChar) + escapeIdChar;

  const suffix = addDot ? '.' : '';

  return escaped + suffix;
}

/**
 * Extract INSERT result IDs from raw database rows.
 *
 * UQL's SQL dialect always aliases the entity's ID column to `id` in RETURNING clauses,
 * so the result rows always contain an `id` property regardless of the entity's @Id() key name.
 */
export function extractInsertResult(rows: RawRow[], changes?: number): QueryUpdateResult {
  const ids = rows.map((r) => r['id']) as QueryUpdateResult['ids'];
  return { changes, ids, firstId: ids?.[0] };
}
