import type { InsertIdSource, QueryUpdateResult, RawRow } from '../type/index.js';
import type { PrimaryKey } from '../type/utility.js';
import { hasKeys } from './object.util.js';

/** Pre-computed regex for each SQL identifier escape character to avoid per-call allocation. */
const escapeIdRegexCache = { '`': /`/g, '"': /"/g } as const satisfies Record<string, RegExp>;

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
 * The name a derived index or constraint gets when nothing named it: `Order__total_idx`.
 *
 * One owner for all four kinds, because it is a rule two layers apply and a third has to match: the
 * entity AST derives it, the DDL generator falls back to it, and a `DROP` names what it drops.
 * `table` is the table's own name, never qualified - the result is a single identifier.
 *
 * The kind goes last, as Postgres spells its own (`users_pkey`, `users_email_idx`), so a table's
 * constraints sort together under the table they belong to.
 *
 * Not overridable, deliberately: a `NamingStrategy` hook would have to reach the eight call sites
 * these have, an introspector and two builders among them, to replace a name any declaration can
 * already set outright with `name:`. Worth revisiting only for a case that option cannot express.
 */
export function derivedConstraintName(
  table: string,
  parts: readonly (string | number)[],
  kind: ConstraintKind,
): string {
  const body = parts.length ? `${table}${TABLE_SEPARATOR}${parts.join('_')}` : table;
  return clampIdentifier(`${body}_${kind}`);
}

/**
 * What separates the table from the columns, doubled where every other join is single.
 *
 * Postgres and SQLite keep index and constraint names in one flat namespace across the whole
 * database rather than scoping them to a table, so a single underscore lets two tables collide:
 * `user` + `profile_id` and `user_profile` + `id` both reduce to `user_profile_id_idx`. Doubling the
 * one ambiguous boundary settles it, on the same assumption Drupal made for the same engines - that
 * nothing sane carries `__` in a table or column name.
 */
const TABLE_SEPARATOR = '__';

/** The kinds of derived name, which is also what `indexNameStem` strips to compare them. */
export type ConstraintKind = 'pk' | 'fk' | 'idx' | 'ck' | 'uk';

/**
 * A name the engine will store whole, shortened around a hash of the full one when it is too long.
 *
 * Truncating alone collides - two long names over the same table differ only in their tail - and a
 * collision means one constraint silently replacing another. The hash is of the *whole* name, so it
 * stays the same on every run, which is what lets a later migration still recognise what it made.
 */
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

/**
 * Escape a SQL identifier (table name, column name, etc.)
 * @param val the identifier to escape
 * @param escapeIdChar the escape character to use (e.g. ` or ")
 * @param forbidQualified whether to forbid qualified identifiers (containing dots)
 * @param addDot whether to add a dot suffix
 */
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
