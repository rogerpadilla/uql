import type { AbstractSqlDialect } from '../../dialect/index.js';
import { SqlExpression, schemaDefault, writtenDefault } from '../../schema/sqlExpression.js';
import { SQL_VALUE_NAMES, type SqlDialectName } from '../../type/index.js';
import { UqlUsageError } from '../../util/uqlError.js';

/** A default in schema form, its SQL compiled with no entity to read: a migration's names no field. */
const ddlDefault = (value: unknown, dialect: AbstractSqlDialect): unknown =>
  schemaDefault(value, (sql) => dialect.compileDdl(sql));

/** How one engine renders a DDL default. A new per-dialect rule is a field here, not a second table. */
type DialectDefaults = {
  /** Column types whose `DEFAULT` this engine takes only as a parenthesized expression. */
  readonly wrapTypes?: RegExp;
  /** Column types whose clock default must repeat their precision, captured by the pattern. */
  readonly preciseTypes?: RegExp;
};

/** MySQL 8.0.13+ rejects `DEFAULT 'x'` on these but accepts `DEFAULT ('x')`, whatever the value. */
const MYSQL_LARGE_TYPES = /^\s*(TINY|MEDIUM|LONG)?(TEXT|BLOB)|^\s*(JSON|GEOMETRY)\b/i;

/** A `DATETIME(3)` or `TIMESTAMP(3)`, whose fractional-second precision is captured. */
const MYSQL_PRECISE_TYPES = /^\s*(?:DATETIME|TIMESTAMP)\((\d)\)/i;

const MYSQL_DEFAULTS: DialectDefaults = { wrapTypes: MYSQL_LARGE_TYPES, preciseTypes: MYSQL_PRECISE_TYPES };

/**
 * Looked up by name rather than carried on the dialect, which keeps DDL data out of the query bundle - the
 * same split that keeps `ENGINE_TYPES` in `schema/canonicalType.ts`.
 */
export const DIALECT_DEFAULTS: Readonly<Record<SqlDialectName, DialectDefaults>> = {
  postgres: {},
  cockroachdb: {},
  mysql: MYSQL_DEFAULTS,
  mariadb: MYSQL_DEFAULTS,
  sqlite: {},
  mssql: {},
};

/**
 * The one place a DDL default becomes SQL: an expression through the dialect's own spelling, anything
 * else as a literal, so `true` is `1` where booleans are integers. `columnType` decides only whether
 * the result needs wrapping, which MySQL demands on its large types whatever the value.
 */
export function formatDefaultValue(value: unknown, dialect: AbstractSqlDialect, columnType?: string): string {
  const sql = defaultLiteral(ddlDefault(value, dialect), dialect, columnType);
  const { wrapTypes } = DIALECT_DEFAULTS[dialect.dialectName];
  return columnType !== undefined && wrapTypes?.test(columnType) ? `(${sql})` : sql;
}

/**
 * Whether a stored default matches the declared one. A literal never matches SQL, even SQL that spells it,
 * and two SQL defaults match when the dialect renders them alike once {@link reprinted} normalizes them.
 */
export function sameDefault(desired: unknown, current: unknown, dialect: AbstractSqlDialect): boolean {
  // Both spellings of "no default" are one fact: MariaDB reports `null` where MySQL reports nothing.
  if (desired == null || current == null) return desired == null && current == null;
  const [want, have] = [ddlDefault(desired, dialect), ddlDefault(current, dialect)];
  if (SqlExpression.isExpression(want) || SqlExpression.isExpression(have)) {
    return (
      SqlExpression.isExpression(want) &&
      SqlExpression.isExpression(have) &&
      reprinted(formatDefaultValue(want, dialect)) === reprinted(formatDefaultValue(have, dialect))
    );
  }
  // Compared as text, since a catalogue may report a number either as a number or as its text.
  return writtenDefault(storedLiteral(want, dialect)) === writtenDefault(storedLiteral(have, dialect));
}

/** A boolean as the engine stores it: the integer {@link defaultLiteral} writes where it has no booleans. */
const storedLiteral = (value: unknown, dialect: AbstractSqlDialect): unknown =>
  typeof value === 'boolean' && dialect.booleanLiteral !== 'native' ? Number(value) : value;

/**
 * Reads SQL a catalogue reports as the value uql exports that renders alike, so a declared `currentTimestamp`
 * compares equal and `generate:from-db` writes it by name; any other SQL is kept as it is.
 */
export function knownDefault(expression: SqlExpression, dialect: AbstractSqlDialect): SqlExpression {
  const name = SQL_VALUE_NAMES.find(
    (kind) => dialect.sqlValues[kind] !== undefined && sameDefault(new SqlExpression(kind), expression, dialect),
  );
  return name ? new SqlExpression(name) : expression;
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

/** A raw expression's own SQL, else the engine's spelling of the value it names. */
function expressionSql({ kind, sql }: SqlExpression, dialect: AbstractSqlDialect, columnType?: string): string {
  if (sql !== undefined) {
    return sql;
  }
  const { preciseTypes } = DIALECT_DEFAULTS[dialect.dialectName];
  if (kind === 'currentTimestamp' && preciseTypes) {
    const precision = columnType === undefined ? undefined : preciseTypes.exec(columnType)?.[1];
    return precision ? `CURRENT_TIMESTAMP(${precision})` : 'CURRENT_TIMESTAMP';
  }
  const spelled = kind === 'sql' ? undefined : dialect.sqlValues[kind];
  if (spelled === undefined) {
    throw new UqlUsageError(`${dialect.dialectName} has no ${kind}; write it as raw SQL this engine accepts`);
  }
  return spelled;
}
