import type { AbstractSqlDialect } from '../../dialect/index.js';
import { SqlExpression, type SqlExpressionKind, writtenDefault } from '../../schema/sqlExpression.js';
import type { SqlDialectName } from '../../type/index.js';
import { UqlUsageError } from '../../util/uqlError.js';

export { SqlExpression, type SqlExpressionKind };

/**
 * Each kind's DDL spelling, or `null` where the engine has none. `raw` carries its own SQL instead. `now`
 * defaults to the dialect's `currentTimestamp`, the clock every other statement reads, unless set here.
 */
export type SqlExpressionMap = Readonly<Record<Exclude<SqlExpressionKind, 'raw' | 'now'>, string | null>> & {
  readonly now?: string;
};

const ANSI: SqlExpressionMap = {
  currentDate: 'CURRENT_DATE',
  currentTime: 'CURRENT_TIME',
  uuid: null,
  uuidv7: null,
  onUpdateNow: null,
};

const PG: SqlExpressionMap = { ...ANSI, uuid: 'gen_random_uuid()' };

const MYSQL: SqlExpressionMap = {
  ...ANSI,
  // Bare, unlike the dialect's `CURRENT_TIMESTAMP(3)`: `preciseTypes` adds the column's own precision.
  now: 'CURRENT_TIMESTAMP',
  uuid: 'UUID()',
  onUpdateNow: 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
};

/** MySQL 8.0.13+ rejects `DEFAULT 'x'` on these but accepts `DEFAULT ('x')`, whatever the value. */
const MYSQL_LARGE_TYPES = /^\s*(TINY|MEDIUM|LONG)?(TEXT|BLOB)|^\s*(JSON|GEOMETRY)\b/i;

/** A `DATETIME(3)` or `TIMESTAMP(3)`, whose fractional-second precision is captured. */
const MYSQL_PRECISE_TYPES = /^\s*(?:DATETIME|TIMESTAMP)\((\d)\)/i;

/** How one engine renders a DDL default. A new per-dialect rule is a field here, not a second table. */
export type DialectDefaults = {
  /** Spelling of each kind, `null` where the engine has none. */
  readonly expressions: SqlExpressionMap;
  /** Column types whose `DEFAULT` this engine takes only as a parenthesized expression. */
  readonly wrapTypes?: RegExp;
  /** Column types whose `CURRENT_TIMESTAMP` default must repeat their precision, captured by the pattern. */
  readonly preciseTypes?: RegExp;
};

/**
 * Looked up by name rather than carried on the dialect, which keeps DDL data out of the query
 * bundle - the same split that keeps `ENGINE_TYPES` in `schema/canonicalType.ts`. `uuidv7()` is
 * Postgres 18+ and `UUID_v7()` MariaDB 11.7+; a server below those rejects it itself, the version
 * not being knowable here.
 */
export const DIALECT_DEFAULTS: Readonly<Record<SqlDialectName, DialectDefaults>> = {
  postgres: { expressions: { ...PG, uuidv7: 'uuidv7()' } },
  cockroachdb: { expressions: PG },
  mysql: { expressions: MYSQL, wrapTypes: MYSQL_LARGE_TYPES, preciseTypes: MYSQL_PRECISE_TYPES },
  mariadb: {
    expressions: { ...MYSQL, uuidv7: 'UUID_v7()' },
    wrapTypes: MYSQL_LARGE_TYPES,
    preciseTypes: MYSQL_PRECISE_TYPES,
  },
  // Writes today in the same text as a bound `Date` at UTC midnight; `CURRENT_DATE` writes a different text.
  sqlite: { expressions: { ...ANSI, currentDate: "(strftime('%Y-%m-%d 00:00:00.000', 'now'))" } },
  // No `uuidv7`: `NEWSEQUENTIALID()` is an ordered v4 GUID, so it carries no readable timestamp and
  // does not sort the way a v7 does elsewhere - a `uuidv7()` default is refused rather than served
  // something that only looks like one.
  mssql: { expressions: { ...ANSI, uuid: 'NEWID()' } },
};

/**
 * Symbolic DDL defaults. Each builds a token the dialect spells at DDL time, so `expr.uuid()` is
 * `gen_random_uuid()` on Postgres and `UUID()` on MySQL from one migration.
 *
 * Use in migrations: `t.timestamp('createdAt', { defaultValue: expr.now() })`
 */
export const expr = {
  /** Current timestamp. */
  now: (): SqlExpression => new SqlExpression('now'),

  /** Current date. */
  currentDate: (): SqlExpression => new SqlExpression('currentDate'),

  /** Current time. */
  currentTime: (): SqlExpression => new SqlExpression('currentTime'),

  /** Generated UUID. SQLite has no built-in one and throws; pass `expr.raw` there. */
  uuid: (): SqlExpression => new SqlExpression('uuid'),

  /**
   * Time-ordered UUID, which indexes far better than a random one as a key. Postgres 18+ and
   * MariaDB 11.7+ only; MySQL, SQLite and CockroachDB have no such function and throw.
   */
  uuidv7: (): SqlExpression => new SqlExpression('uuidv7'),

  /** MySQL's `ON UPDATE CURRENT_TIMESTAMP`. Throws on dialects without it. */
  onUpdateNow: (): SqlExpression => new SqlExpression('onUpdateNow'),

  /** SQL taken verbatim, for anything the kinds above do not cover. Not portable by definition. */
  raw: (sql: string): SqlExpression => new SqlExpression('raw', sql),
};

/**
 * The one place a DDL default becomes SQL: an expression through the dialect's own spelling, anything
 * else as a literal, so `true` is `1` where booleans are integers. `columnType` decides only whether
 * the result needs wrapping, which MySQL demands on its large types whatever the value.
 */
export function formatDefaultValue(value: unknown, dialect: AbstractSqlDialect, columnType?: string): string {
  const sql = defaultLiteral(value, dialect, columnType);
  const { wrapTypes } = DIALECT_DEFAULTS[dialect.dialectName];
  return columnType !== undefined && wrapTypes?.test(columnType) ? `(${sql})` : sql;
}

/**
 * Whether a stored default matches the declared one. A literal never matches SQL, even SQL that spells it,
 * and two SQL defaults match when the dialect renders them alike once {@link reprinted} normalizes them.
 */
export function sameDefault(desired: unknown, current: unknown, dialect: AbstractSqlDialect): boolean {
  // Both spellings of "no default" are the same fact, and engines disagree on which they report:
  // MariaDB says `null` where MySQL says nothing at all. Reading them as different values asked to
  // `MODIFY` every nullable column, on every sync, forever.
  if (desired == null || current == null) return desired == null && current == null;
  if (SqlExpression.isExpression(desired) || SqlExpression.isExpression(current)) {
    return (
      SqlExpression.isExpression(desired) &&
      SqlExpression.isExpression(current) &&
      reprinted(formatDefaultValue(desired, dialect)) === reprinted(formatDefaultValue(current, dialect))
    );
  }
  // Compared as text, since a catalogue may report a number either as a number or as its text.
  return writtenDefault(desired) === writtenDefault(current);
}

/**
 * Normalizes what engines reprint differently in SQL: it lowercases, collapses spacing, and strips wrapping
 * parentheses (SQLite and MySQL drop them, SQL Server adds them) and the empty argument list of
 * CockroachDB's `current_timestamp()`.
 */
function reprinted(sql: string): string {
  let text = sql
    .toLowerCase()
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  while (/^\(.*\)$/s.test(text)) {
    text = text.slice(1, -1);
  }
  return text.replace(/\(\)$/, '');
}

/**
 * Quoting is the dialect's `escape`, so a backslash in a default is escaped the way the engine reads
 * it - MySQL takes `'a\b'` as a backspace where Postgres takes it literally. Only the cases `escape`
 * cannot serve stay here: a boolean is `1` where booleans are integers, and a plain object or array
 * is JSON rather than the throw and the IN-list `escape` gives them.
 */
function defaultLiteral(value: unknown, dialect: AbstractSqlDialect, columnType?: string): string {
  if (value === undefined || value === null) {
    return 'NULL';
  }
  if (SqlExpression.isExpression(value)) {
    return expressionSql(value, dialect, columnType);
  }
  if (typeof value === 'boolean') {
    return dialect.booleanLiteral === 'native' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  }
  return dialect.escape(typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);
}

function expressionSql(expression: SqlExpression, dialect: AbstractSqlDialect, columnType?: string): string {
  const { expressions, preciseTypes } = DIALECT_DEFAULTS[dialect.dialectName];
  const raw = expression.kind === 'raw';
  const sql = raw ? expression.sql : { now: dialect.currentTimestamp, ...expressions }[expression.kind];
  if (sql == null) {
    throw new UqlUsageError(
      `${dialect.dialectName} has no '${expression.kind}' default; pass expr.raw(...) with SQL this engine accepts`,
    );
  }
  // A raw default is the caller's SQL, never rewritten.
  const precision = raw || columnType === undefined ? undefined : preciseTypes?.exec(columnType)?.[1];
  return precision === undefined ? sql : sql.replaceAll('CURRENT_TIMESTAMP', `CURRENT_TIMESTAMP(${precision})`);
}
