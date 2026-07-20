import type { InsertIdSource, Key, QueryUpdateResult, RawRow } from '../type/index.js';
import type { PrimaryKey } from '../type/utility.js';
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
  /** The first auto-generated ID from the driver header (MySQL `insertId`; no `RETURNING`). */
  id?: PrimaryKey;
  /** How the dialect surfaces inserted IDs (see {@link InsertIdSource}). */
  insertIdSource?: InsertIdSource;
  /**
   * Auto-increment stride for header-derived id inference. Defaults to 1; a clustered MySQL
   * server (e.g. Galera, group replication) may set `auto_increment_increment` higher.
   */
  insertIdIncrement?: number;
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
 *
 * The header-derived ID path assumes the database allocated consecutive values for the
 * statement, which holds for a single multi-row `INSERT ... VALUES` on auto-increment keys
 * (with the standard `auto_increment_increment = 1`); the querier only maps these IDs onto
 * payloads when that assumption is safe.
 *
 * Caveat (MySQL/MariaDB-compatible engines with no `RETURNING`, i.e. `insertIdSource: 'firstId'`):
 * contiguous allocation across a statement's rows is only guaranteed under
 * `innodb_autoinc_lock_mode` 0 (`traditional`) or 1 (`consecutive`). Under mode 2 (`interleaved`,
 * MySQL 8.0's default), other connections inserting into the same table concurrently with this
 * statement can interleave with its auto-increment allocation, so the inferred IDs may not be
 * contiguous. There is no code-level fix for this (MySQL has no `RETURNING`); avoid relying on
 * inferred multi-row IDs for a table under heavy concurrent insert load, or set
 * `innodb_autoinc_lock_mode` to 0 or 1.
 */
export function buildUpdateResult(payload: BuildUpdateResultPayload): QueryUpdateResult {
  const { rows, id, insertIdSource, upsertStatus } = payload;
  const changes = payload.changes ?? rows?.length ?? 0;
  const stride = payload.insertIdIncrement && payload.insertIdIncrement > 0 ? payload.insertIdIncrement : 1;

  // ID mapping. RETURNING rows are exact. Otherwise the sequence is derived from the single id in
  // the driver header: `firstId` dialects (MySQL) report the FIRST generated id, and the rest are
  // inferred by incrementing it. A header id of `0`/`0n` means no id was generated (e.g. a
  // non-auto-increment key), so we infer none.
  //
  // This arithmetic assumes `changes` equals the batch's row count, which always holds for a plain
  // `insertMany` - but not for `upsertMany` on a `firstId` dialect (MySQL): its `ON DUPLICATE KEY
  // UPDATE` convention makes `changes` a per-row weighted sum (1=insert, 2=update, 0=no-op), so a
  // batch mixing an insert and an update would fabricate ids for rows that were never touched. This
  // function has no way to tell the two call sites apart (`internalRun` reports the same header
  // shape either way), so `AbstractSqlQuerier.upsertMany` strips `ids`/`firstId`/`created` back down
  // to just `changes` for a multi-row `firstId`-dialect upsert after calling this.
  let ids: PrimaryKey[] = [];
  if (rows?.length) {
    ids = rows.map((r) => r['id'] as PrimaryKey);
  } else if (insertIdSource !== 'returning' && isPrimaryKey(id) && id) {
    if (typeof id === 'string') {
      if (changes === 1) ids = [id];
    } else {
      ids = sequentialIds(id, changes, stride);
    }
  }

  // 2. Creation Status
  // PostgreSQL: `(xmax = 0) AS "_created"` in the RETURNING clause provides a boolean per row.
  // MySQL: `affectedRows` convention - 1 = insert, 2 = update, 0 = no-op. Gated on `!== 'returning'`
  // since that convention is unreliable once RETURNING is in play (verified: MariaDB's affectedRows
  // for an `ON DUPLICATE KEY UPDATE ... RETURNING` statement differs by driver and doesn't follow
  // the 1/2/0 convention at all) - `insertIdSource === 'returning'` dialects without a `_created`
  // column (MariaDB, SQLite, CockroachDB) correctly get `undefined` instead of a misleading guess.
  const created =
    (rows?.length === 1 ? (rows[0]?.['_created'] as boolean | undefined) : undefined) ??
    (insertIdSource !== 'returning' && typeof upsertStatus === 'number' && upsertStatus >= 0 && upsertStatus <= 2
      ? upsertStatus === 1
      : undefined);

  return { changes, ids, firstId: ids?.[0], created };
}

/** Build `count` ids starting at `first`, incrementing by `step` (bigint- and number-safe). */
function sequentialIds(first: number | bigint, count: number, step: number): PrimaryKey[] {
  return typeof first === 'bigint'
    ? Array.from({ length: count }, (_, i) => first + BigInt(i) * BigInt(step))
    : Array.from({ length: count }, (_, i) => first + i * step);
}

/**
 * Checks if a value is of a primary key type (string, number, or bigint).
 */
export function isPrimaryKey(val: unknown): val is PrimaryKey {
  return typeof val === 'string' || typeof val === 'number' || typeof val === 'bigint';
}
