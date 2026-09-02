import type { AbstractSqlDialect } from '../../dialect/index.js';
import type { ColumnSchema, SqlDialectName } from '../../type/index.js';

/**
 * A {@link ColumnSchema.defaultValue} that is SQL rather than a literal. Kinds are symbolic: the
 * dialect names the spelling and {@link formatDefaultValue} renders one at DDL time.
 */
export type SqlExpressionKind = 'now' | 'currentDate' | 'currentTime' | 'uuid' | 'uuidv7' | 'onUpdateNow' | 'raw';

/** Every kind's DDL spelling, `null` where an engine has none. `raw` carries its own text instead. */
export type SqlExpressionMap = Readonly<Record<Exclude<SqlExpressionKind, 'raw'>, string | null>>;

const ANSI: SqlExpressionMap = {
  now: 'CURRENT_TIMESTAMP',
  currentDate: 'CURRENT_DATE',
  currentTime: 'CURRENT_TIME',
  uuid: null,
  uuidv7: null,
  onUpdateNow: null,
};

const PG: SqlExpressionMap = { ...ANSI, uuid: 'gen_random_uuid()' };

const MYSQL: SqlExpressionMap = {
  ...ANSI,
  uuid: 'UUID()',
  onUpdateNow: 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
};

/** MySQL 8.0.13+ rejects `DEFAULT 'x'` on these but accepts `DEFAULT ('x')`, whatever the value. */
const MYSQL_LARGE_TYPES = /^\s*(TINY|MEDIUM|LONG)?(TEXT|BLOB)|^\s*(JSON|GEOMETRY)\b/i;

/** How one engine renders a DDL default. A new per-dialect rule is a field here, not a second table. */
export type DialectDefaults = {
  /** Spelling of each kind, `null` where the engine has none. */
  readonly expressions: SqlExpressionMap;
  /** Column types whose `DEFAULT` this engine takes only as a parenthesized expression. */
  readonly wrapTypes?: RegExp;
};

/**
 * Looked up by name rather than carried on the dialect, which keeps DDL data out of the query
 * bundle - the same split that keeps `CANONICAL_TO_SQL` in `schema/canonicalType.ts`. `uuidv7()` is
 * Postgres 18+ and `UUID_v7()` MariaDB 11.7+; a server below those rejects it itself, the version
 * not being knowable here.
 */
export const DIALECT_DEFAULTS: Readonly<Record<SqlDialectName, DialectDefaults>> = {
  postgres: { expressions: { ...PG, uuidv7: 'uuidv7()' } },
  cockroachdb: { expressions: PG },
  mysql: { expressions: MYSQL, wrapTypes: MYSQL_LARGE_TYPES },
  mariadb: { expressions: { ...MYSQL, uuidv7: 'UUID_v7()' }, wrapTypes: MYSQL_LARGE_TYPES },
  sqlite: { expressions: ANSI },
};

/**
 * A DDL default that is SQL rather than a literal. A class, not a plain object, so a JSON default
 * cannot masquerade as one: `defaultValue` accepts `unknown`.
 */
export class SqlExpression {
  /** `sql` is set only for the `raw` kind, which carries its own text verbatim. */
  constructor(
    readonly kind: SqlExpressionKind,
    readonly sql?: string,
  ) {}

  static isExpression(value: unknown): value is SqlExpression {
    return value instanceof SqlExpression;
  }
}

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
  const sql = defaultLiteral(value, dialect);
  const { wrapTypes } = DIALECT_DEFAULTS[dialect.dialectName];
  return columnType !== undefined && wrapTypes?.test(columnType) ? `(${sql})` : sql;
}

/**
 * Quoting is the dialect's `escape`, so a backslash in a default is escaped the way the engine reads
 * it - MySQL takes `'a\b'` as a backspace where Postgres takes it literally. Only the cases `escape`
 * cannot serve stay here: a boolean is `1` where booleans are integers, and a plain object or array
 * is JSON rather than the throw and the IN-list `escape` gives them.
 */
function defaultLiteral(value: unknown, dialect: AbstractSqlDialect): string {
  if (value === undefined || value === null) {
    return 'NULL';
  }
  if (SqlExpression.isExpression(value)) {
    return expressionSql(value, dialect);
  }
  if (typeof value === 'boolean') {
    return dialect.booleanLiteral === 'native' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  }
  if (value instanceof Date) {
    return dialect.escape(ddlTimestamp(value));
  }
  if (typeof value === 'object') {
    return dialect.escape(JSON.stringify(value));
  }
  return dialect.escape(value);
}

/**
 * `YYYY-MM-DD HH:mm:ss.SSS` in UTC. Not `toISOString`, whose `T` and `Z` MySQL rejects outright
 * ("Invalid default value"), and not `escape`'s local-time form, which would make the DDL depend on
 * the machine that generated it.
 */
function ddlTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function expressionSql(expression: SqlExpression, dialect: AbstractSqlDialect): string {
  const { expressions } = DIALECT_DEFAULTS[dialect.dialectName];
  const sql = expression.kind === 'raw' ? expression.sql : expressions[expression.kind];
  if (sql == null) {
    throw new TypeError(
      `${dialect.dialectName} has no '${expression.kind}' default; pass expr.raw(...) with SQL this engine accepts`,
    );
  }
  return sql;
}
