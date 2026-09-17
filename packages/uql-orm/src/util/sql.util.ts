import type { InsertIdSource, QueryUpdateResult, RawRow } from '../type/index.js';
import type { PrimaryKey } from '../type/utility.js';
import { hasKeys } from './object.util.js';

/** Pre-computed regex for each SQL identifier escape character to avoid per-call allocation. */
const escapeIdRegexCache = { '`': /`/g, '"': /"/g } as const satisfies Record<string, RegExp>;

export function unflatObjects<T extends object>(objects: RawRow[]): T[] {
  if (!objects.length) {
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
 * A name behind its namespace, or bare where there is none: the one place the two are joined, so a
 * table's key, its statement operand and its escaped form cannot spell it differently. Never the
 * seed for a derived identifier - an index or constraint name is a single identifier, and
 * `sales.Order_total_idx` is a syntax error.
 */
export function qualifyName(name: string, schema?: string): string {
  return schema ? `${schema}.${name}` : name;
}

/**
 * The longest identifier every engine here accepts. Postgres truncates silently at 63 bytes and
 * MySQL errors at 64, so one conservative limit needs no per-dialect plumbing to be safe on both -
 * and SQLite, which has no limit, loses nothing by observing it.
 */
const MAX_IDENTIFIER_LENGTH = 63;

/** Hex chars of hash kept when a name has to be shortened. 24 bits over one table's constraints. */
const NAME_HASH_LENGTH = 6;

/**
 * The name a derived index or constraint gets, `Order__total_idx`, kind last as Postgres names its own.
 * One rule for the AST, the DDL and a `DROP`; not a naming strategy hook, since `name:` already overrides it.
 */
export function derivedConstraintName(
  table: string,
  parts: readonly (string | number)[],
  kind: ConstraintKind,
): string {
  const body = parts.length ? `${table}${TABLE_SEPARATOR}${parts.join('_')}` : table;
  return clampIdentifier(`${body}_${kind}`);
}

/** Between table and columns, doubled: index names share one namespace per database, where `a` + `b_c` and `a_b` + `c` would collide. */
const TABLE_SEPARATOR = '__';

/** The kinds of derived name, which is also what `indexNameStem` strips to compare them. */
export type ConstraintKind = 'pk' | 'fk' | 'idx' | 'ck' | 'uk';

/** A name the engine stores whole, shortened around a hash of the full one, which stays stable across runs. */
function clampIdentifier(name: string): string {
  if (name.length <= MAX_IDENTIFIER_LENGTH) {
    return name;
  }
  const suffix = `_${hashIdentifier(name)}`;
  return name.slice(0, MAX_IDENTIFIER_LENGTH - suffix.length) + suffix;
}

/**
 * FNV-1a, by hand: the package ships zero runtime dependencies, and `node:crypto` is not reachable
 * from the browser and edge entries this module is bundled into. Not a security hash - it only has
 * to spread the names of one table's constraints.
 */
function hashIdentifier(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(NAME_HASH_LENGTH, '0').slice(-NAME_HASH_LENGTH);
}

/**
 * The name a derived index gets when nothing named it: `Order__total_idx`, or `Order__total_uk` for a
 * unique one - which the builder has always spelled apart, and which reads as what it enforces.
 */
export function derivedIndexName(table: string, columns: readonly string[], unique = false): string {
  return derivedConstraintName(table, columns, unique ? 'uk' : 'idx');
}

/**
 * The constraint name a primary key gets when we name one: `Enrolment__studentId_courseId_pk`.
 *
 * Only ever used to *emit* a key. Which columns a key holds is what decides whether two keys are the
 * same, so an existing constraint keeps whatever the engine called it - see `SchemaDiff.primaryKey`.
 */
export function derivedPrimaryKeyName(table: string, columns: readonly string[]): string {
  return derivedConstraintName(table, columns, 'pk');
}

/** The constraint name a check gets when nothing named it: `Order__1_ck`, by declaration order. */
export function derivedCheckName(table: string, position: number): string {
  return derivedConstraintName(table, [position], 'ck');
}

/** The constraint name a foreign key gets when nothing named it: `Order__customerId_fk`. */
export function derivedForeignKeyName(table: string, columns: readonly string[]): string {
  return derivedConstraintName(table, columns, 'fk');
}

/** Escapes an identifier with `escapeIdChar`, refusing a dotted one where `forbidQualified`, with a trailing dot where `addDot`. */
export function escapeSqlId(
  val: string | undefined,
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
 * A driver's result as a {@link QueryUpdateResult}: `RETURNING` rows name their id `id`; a MySQL header's
 * first id is extended by the increment, which holds only where auto-increment allocation is contiguous
 * (`innodb_autoinc_lock_mode` 0 or 1).
 */
export function buildUpdateResult(payload: BuildUpdateResultPayload): QueryUpdateResult {
  const { rows, id, insertIdSource, upsertStatus } = payload;
  const changes = payload.changes ?? rows?.length ?? 0;
  const stride = payload.insertIdIncrement && payload.insertIdIncrement > 0 ? payload.insertIdIncrement : 1;

  // Ids from `RETURNING` are exact; otherwise from the header's first id onward, which assumes `changes`
  // counts the rows (false for a MySQL upsert batch, whose querier reads ids back instead). `0` means none.
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

  // Whether the row was created: Postgres's `_created` column, or MySQL's 1/2/0 `affectedRows`,
  // which is unreliable under `RETURNING`, so those dialects report nothing.
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
