import { OWNED_PREFIX } from '../dialect/aliases.js';
import type { InsertIdSource, QueryUpdateResult, RawRow } from '../type/index.js';
import type { PrimaryKey } from '../type/utility.js';
import { fnv1a } from './string.util.js';

/**
 * A name behind its namespace, or bare where there is none: the one place the two are joined, so a
 * table's key, its statement operand and its escaped form cannot spell it differently. Never the
 * seed for a derived identifier - an index or constraint name is a single identifier, and
 * `sales.Order_total_idx` is a syntax error.
 */
export function qualifyName(name: string, schema?: string): string {
  return schema ? `${schema}.${name}` : name;
}

/** Reverses {@link qualifyName}: splits at the last dot into the schema, if any, and the name. */
export function splitQualifiedName(qualified: string): { readonly name: string; readonly schema?: string } {
  const dot = qualified.lastIndexOf('.');
  return dot < 0 ? { name: qualified } : { name: qualified.slice(dot + 1), schema: qualified.slice(0, dot) };
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
 * The name of a derived index or constraint, such as `Order__total_idx`, with the kind last as Postgres names
 * its own. It leaves out the table's schema, since it is a single identifier. The AST, the DDL and a `DROP`
 * all use this one rule.
 */
function derivedConstraintName(table: string, parts: readonly string[], kind: ConstraintKind): string {
  const { name } = splitQualifiedName(table);
  const body = parts.length ? `${name}${TABLE_SEPARATOR}${parts.join('_')}` : name;
  return clampIdentifier(`${body}_${kind}`);
}

/** Between table and columns, doubled: index names share one namespace per database, where `a` + `b_c` and `a_b` + `c` would collide. */
const TABLE_SEPARATOR = '__';

/** The kinds of derived name, its last part. */
type ConstraintKind = 'pk' | 'fk' | 'idx' | 'uk';

/** What every name uql installs begins with, so the two ends asking about one cannot spell it apart. */
const OWNED_START = `${OWNED_PREFIX}_`;

/**
 * Whether uql installed the object called `name`. Ownership is the prefix and nothing else, since no
 * engine records who created one - so this is the only thing standing between a hand-written trigger or
 * check and a `DROP`, and it is asked on both sides: when reading the catalogue, and again before emitting.
 */
export function isOwnedName(name: string): boolean {
  return name.startsWith(OWNED_START);
}

/**
 * The identifier uql installs a schema object under: its own prefix, the table it hangs off, the label
 * the author gave it, and last a hash of the object's `content`, which no clamping cuts. The table keeps
 * two entities sharing a label apart where an engine scopes such names to the schema.
 */
export function ownedName(table: string, label: string, content: string): string {
  const version = `_${hashIdentifier(content)}`;
  return clampIdentifier(`${OWNED_START}${table}${TABLE_SEPARATOR}${label}`, version.length) + version;
}

/** A name the engine stores whole, shortened around a hash of the full one, which stays stable across runs. */
function clampIdentifier(name: string, reserved = 0): string {
  const max = MAX_IDENTIFIER_LENGTH - reserved;
  if (name.length <= max) {
    return name;
  }
  const suffix = `_${hashIdentifier(name)}`;
  return name.slice(0, max - suffix.length) + suffix;
}

/** A short hash that keeps one table's constraint names apart; it needs to do nothing more. */
function hashIdentifier(value: string): string {
  return fnv1a(value).toString(16).padStart(NAME_HASH_LENGTH, '0').slice(-NAME_HASH_LENGTH);
}

/**
 * The name a derived index gets when nothing named it: `Order__total_idx`, or `Order__total_uk` for a
 * unique one. A partial index also carries a hash of its `where`, so an edited predicate is a new name.
 */
export function derivedIndexName(table: string, columns: readonly string[], unique = false, where?: string): string {
  const parts = where === undefined ? columns : [...columns, hashIdentifier(where)];
  return derivedConstraintName(table, parts, unique ? 'uk' : 'idx');
}

/** The hash a partial index's derived name carries before its kind. */
const PREDICATE_HASH = new RegExp(`_[0-9a-f]{${NAME_HASH_LENGTH}}(?=_(?:idx|uk)$)`);

/**
 * Whether uql named the index `name` itself from `columns`: `derivedIndexName`'s forms, with a predicate's hash or
 * without, and the `idx_<table>_<columns>` spelling an older uql gave one.
 */
export function isDerivedIndexName(table: string, columns: readonly string[], name: string): boolean {
  const plain = [derivedIndexName(table, columns), derivedIndexName(table, columns, true)];
  return (
    plain.includes(name) ||
    plain.includes(name.replace(PREDICATE_HASH, '')) ||
    name === `idx_${table}_${columns.join('_')}`
  );
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
  const escaped =
    !forbidQualified && val.includes('.')
      ? val
          .split('.')
          .map((part) => escapeSqlId(part, escapeIdChar, true))
          .join('.')
      : `${escapeIdChar}${val.replaceAll(escapeIdChar, escapeIdChar + escapeIdChar)}${escapeIdChar}`;
  return addDot ? `${escaped}.` : escaped;
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
}

/**
 * A driver's result as a {@link QueryUpdateResult}: `RETURNING` rows name their id `id`; a MySQL header's
 * first id is extended by the increment, which holds only where auto-increment allocation is contiguous
 * (`innodb_autoinc_lock_mode` 0 or 1).
 */
export function buildUpdateResult(payload: BuildUpdateResultPayload): QueryUpdateResult {
  const { rows, id, insertIdSource } = payload;
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

  return { changes, ids };
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
