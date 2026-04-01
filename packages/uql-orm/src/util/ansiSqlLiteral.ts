/**
 * ANSI-style SQL **string literal** escaping (single-quote doubling) for Postgres, SQLite, and
 * related dialects. Distinct from MySQL backslash escaping (`mysqlLikeSqlDialect` / npm `sqlstring`).
 *
 * **Security**
 * - Prefer **bound parameters** (`?`, `$1`, …) for all user-controlled values; this helper is for
 *   the rare inline-literal path (`Dialect.escape`).
 * - Values with `toSqlString()` are emitted **raw** (escape hatch); never attach that method to
 *   untrusted input.
 * - Plain objects are rejected so we never emit ambiguous or dialect-wrong `key = val` fragments.
 *
 * PostgreSQL **array** literals (`{...}` with double-quoted elements and their own escape rules)
 * are separate from this helper; see {@link PostgresDialect} (array text format when
 * `nativeArrays` is false) — do not “unify” that path with this function.
 */

const SINGLE_QUOTE = /'/g;

function escapeStringLiteral(val: string): string {
  return `'${val.replace(SINGLE_QUOTE, "''")}'`;
}

function zeroPad(n: number, len: number): string {
  let s = String(n);
  while (s.length < len) s = `0${s}`;
  return s;
}

/** `YYYY-MM-DD HH:mm:ss.mmm` in local time, wrapped as a quoted literal. */
function dateToLocalSqlLiteral(date: Date): string {
  const y = date.getFullYear();
  const mo = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const mi = date.getMinutes();
  const s = date.getSeconds();
  const ms = date.getMilliseconds();
  const inner = `${zeroPad(y, 4)}-${zeroPad(mo, 2)}-${zeroPad(d, 2)} ${zeroPad(h, 2)}:${zeroPad(mi, 2)}:${zeroPad(s, 2)}.${zeroPad(ms, 3)}`;
  return escapeStringLiteral(inner);
}

function isByteSource(val: object): val is Uint8Array {
  return (typeof Buffer !== 'undefined' && Buffer.isBuffer(val)) || val instanceof Uint8Array;
}

function bytesToHexLiteral(buf: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, '0');
  }
  return `X'${hex}'`;
}

function arrayToSqlList(arr: unknown[]): string {
  let sql = '';
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i]!;
    if (Array.isArray(val)) {
      sql += `${i === 0 ? '' : ', '}(${arrayToSqlList(val)})`;
    } else {
      sql += `${i === 0 ? '' : ', '}${escapeAnsiSqlLiteral(val)}`;
    }
  }
  return sql;
}

/**
 * Escape `value` as an SQL literal (or `NULL`). Throws on unsupported types so callers cannot
 * accidentally stringify attacker-controlled objects into SQL.
 */
export function escapeAnsiSqlLiteral(value: unknown): string {
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
      return escapeStringLiteral(value);
    case 'symbol':
    case 'function':
      throw new TypeError('escapeAnsiSqlLiteral: symbol and function values are not supported; use bound parameters.');
    case 'object': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? 'NULL' : dateToLocalSqlLiteral(value);
      }
      if (Array.isArray(value)) {
        return arrayToSqlList(value);
      }
      if (isByteSource(value)) {
        return bytesToHexLiteral(value);
      }
      if ('toSqlString' in value && typeof (value as { toSqlString?: unknown }).toSqlString === 'function') {
        return String((value as { toSqlString: () => unknown }).toSqlString());
      }
      throw new TypeError(
        'escapeAnsiSqlLiteral: plain objects are not supported; use bound parameters or JSON.stringify + a string column.',
      );
    }
    default:
      // Defensive: all current `typeof` results are handled above.
      return escapeStringLiteral(String(value));
  }
}
