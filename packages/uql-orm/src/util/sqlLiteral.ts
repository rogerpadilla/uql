/**
 * SQL string literal escaping for `Dialect.escape`, in two flavors: ANSI single-quote doubling
 * (Postgres, SQLite) and MySQL backslash escaping (MySQL, MariaDB). Only the quoting step differs.
 *
 * **Security.** UQL never calls `Dialect.escape` itself, so this is the hand-written-SQL hatch; prefer
 * bound parameters. Two limits are inherent to inline MySQL literals (`sqlstring` and `sql-escaper`
 * share them): escaping breaks under the server's `NO_BACKSLASH_ESCAPES` mode, and under a charset
 * whose trailing byte can be `0x5C` (GBK, Big5, SJIS). `toSqlString()` values are emitted raw.
 *
 * PostgreSQL **array** literals (`{...}` with double-quoted elements and their own escape rules)
 * are separate from this helper; see {@link PostgresDialect} (array text format when
 * `nativeArrays` is false) - do not "unify" that path with this function.
 */

type StringLiteralEscaper = (val: string) => string;

const SINGLE_QUOTE = /'/g;

/** Doubles every single quote in `val`, the ANSI escaping shared by string literals and JSON path keys. */
export function escapeSingleQuotes(val: string): string {
  return val.replace(SINGLE_QUOTE, "''");
}

const ansiStringLiteral: StringLiteralEscaper = (val) => `'${escapeSingleQuotes(val)}'`;

// MySQL/MariaDB backslash-escape rather than doubling the quote. Mirrors the `sqlstring` map it replaced.
// oxlint-disable-next-line no-control-regex -- MySQL string literals must escape NUL, backspace and SUB
const MYSQL_SPECIALS = /[\0\b\t\n\r\x1a"'\\]/g;
const MYSQL_ESCAPES: Record<string, string> = {
  '\0': '\\0',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\Z',
  '"': '\\"',
  "'": "\\'",
  '\\': '\\\\',
};

const mysqlStringLiteral: StringLiteralEscaper = (val) =>
  `'${val.replace(MYSQL_SPECIALS, (char) => MYSQL_ESCAPES[char])}'`;

const pad = (value: number, len: number): string => String(value).padStart(len, '0');

function isByteSource(val: object): val is Uint8Array {
  return (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) || val instanceof Uint8Array;
}

const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/** Native hex encoder where available (~130x faster on 4 KB); lookup table for browsers. */
function bytesToHexLiteral(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return `X'${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex')}'`;
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += HEX_BYTES[bytes[i]];
  return `X'${hex}'`;
}

/**
 * A factory, not a function taking `escapeString` as an argument: threading it through every call
 * measured 1.1-1.5x slower. Rejects unsupported types rather than stringifying them into SQL.
 */
function createEscaper(escapeString: StringLiteralEscaper): (value: unknown) => string {
  /** `YYYY-MM-DD HH:mm:ss.mmm` in local time, wrapped as a quoted literal. */
  const dateLiteral = (date: Date): string =>
    escapeString(
      `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`,
    );

  const sqlList = (arr: unknown[]): string => {
    let sql = '';
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (i > 0) sql += ', ';
      sql += Array.isArray(val) ? `(${sqlList(val)})` : escapeValue(val);
    }
    return sql;
  };

  /** Split out so the `typeof` switch below stays a flat one-line-per-type dispatch. */
  const escapeObject = (value: object): string => {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 'NULL' : dateLiteral(value);
    }
    if (Array.isArray(value)) {
      return sqlList(value);
    }
    if (isByteSource(value)) {
      return bytesToHexLiteral(value);
    }
    if ('toSqlString' in value && typeof (value as { toSqlString?: unknown }).toSqlString === 'function') {
      return String((value as { toSqlString: () => unknown }).toSqlString());
    }
    throw new TypeError(
      'escapeSqlLiteral: plain objects are not supported; use bound parameters or JSON.stringify + a string column.',
    );
  };

  const escapeValue = (value: unknown): string => {
    if (value === undefined || value === null) {
      return 'NULL';
    }

    switch (typeof value) {
      case 'boolean':
        return value ? 'true' : 'false';
      case 'number':
        return Number.isFinite(value) ? String(value) : 'NULL';
      case 'bigint':
        return String(value);
      case 'string':
        return escapeString(value);
      case 'object':
        return escapeObject(value);
      case 'symbol':
      case 'function':
        throw new TypeError('escapeSqlLiteral: symbol and function values are not supported; use bound parameters.');
      default:
        // Unreachable today; throwing keeps a future JS type from silently becoming SQL.
        throw new TypeError(`escapeSqlLiteral: unsupported value type '${typeof value}'; use bound parameters.`);
    }
  };

  return escapeValue;
}

/** Escape `value` for Postgres, SQLite and related dialects (single-quote doubling). */
export const escapeAnsiSqlLiteral = createEscaper(ansiStringLiteral);

/** Escape `value` for MySQL and MariaDB (backslash escaping). */
export const escapeMysqlSqlLiteral = createEscaper(mysqlStringLiteral);
