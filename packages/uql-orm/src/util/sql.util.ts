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

function flatObjectEntry<E>(map: E, key: string, val: unknown, pre?: string): E {
  const prefix = pre ? `${pre}.${key}` : key;
  if (typeof val === 'object' && val !== null) {
    return getKeys(val).reduce(
      (acc, prop) => flatObjectEntry(acc, prop, (val as Record<string, unknown>)[prop], prefix),
      map,
    );
  }
  (map as Record<string, unknown>)[prefix] = val;
  return map;
}

export function unflatObjects<T extends object>(objects: RawRow[]): T[] {
  if (!Array.isArray(objects) || !objects.length) {
    return objects as T[];
  }

  const attrsPaths = obtainAttrsPaths(objects[0]);

  if (!hasKeys(attrsPaths)) {
    return objects as T[];
  }

  return objects.map((row) => unflatObject<T>(row, attrsPaths));
}

/**
 * Unflattens a single raw row using pre-computed attribute paths.
 * Use this for streaming to avoid per-row array allocations.
 */
export function unflatObject<T extends object>(row: RawRow, attrsPaths: Record<string, string[]>): T {
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
 * Payload for building a QueryUpdateResult.
 */
export interface BuildUpdateResultPayload {
  /** The count of rows affected by the statement. */
  changes?: number;
  /** The raw rows returned by the query (for RETURNING clauses). */
  rows?: RawRow[];
  /** The first (MySQL) or last (SQLite) auto-generated ID from the driver header. */
  id?: number | bigint;
  /** The ID strategy: 'first' (MySQL/MariaDB) or 'last' (SQLite/LibSQL/D1). */
  insertIdStrategy?: 'first' | 'last';
  /**
   * Driver-specific upsert detection from the result header.
   * MySQL/MariaDB `ON DUPLICATE KEY UPDATE` convention: 1 = insert, 2 = update, 0 = no-op.
   */
  upsertStatus?: number;
}

/**
 * Unified utility to build a QueryUpdateResult from driver-specific results.
 *
 * UQL's SQL dialects always alias the entity's ID column to `id` in RETURNING clauses,
 * so the result rows always contain an `id` property regardless of the entity's @Id() key name.
 */
export function buildUpdateResult(payload: BuildUpdateResultPayload): QueryUpdateResult {
  const { rows, id, insertIdStrategy, upsertStatus } = payload;
  const changes = payload.changes ?? rows?.length ?? 0;

  // 1. ID Mapping
  let firstId: any;
  if (rows?.[0]?.['id'] !== undefined) {
    firstId = rows[0]['id'];
  } else if (id !== undefined) {
    firstId = insertIdStrategy === 'last' ? Number(id) - (changes - 1) : Number(id);
  }

  const ids: any[] = rows?.length
    ? rows.map((r) => r['id'])
    : firstId
      ? Array.from({ length: changes }, (_, i) => firstId + i)
      : [];

  // 2. Creation Status
  // PostgreSQL: `(xmax = 0) AS "_created"` in the RETURNING clause provides a boolean per row.
  // MySQL/MariaDB: `affectedRows` convention — 1 = insert, 2 = update, 0 = no-op.
  const created =
    (rows && rows.length === 1 ? (rows[0]?.['_created'] as boolean | undefined) : undefined) ??
    (upsertStatus !== undefined && upsertStatus <= 2 ? upsertStatus === 1 : undefined);

  return { changes, ids, firstId: ids?.[0], created };
}
