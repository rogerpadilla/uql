import { type IndexColumnInput, type IndexColumnSchema, QueryRaw, RAW_VALUE } from '../type/index.js';

/**
 * Reduces an authored index entry to its normalized form, so the three shapes users write - a column
 * name, `raw(expression)`, or an options object - reach the dialects as one.
 */
export function normalizeIndexColumn(entry: IndexColumnInput): IndexColumnSchema {
  if (typeof entry === 'string') {
    return { column: entry };
  }
  if (entry instanceof QueryRaw) {
    return { column: rawSql(entry), expression: true };
  }
  const { column, ...rest } = entry;
  return column instanceof QueryRaw ? { ...rest, column: rawSql(column), expression: true } : { ...rest, column };
}

/** The partial-index predicate, as authored: `raw` for new code, a bare string for old. */
export function normalizeIndexWhere(where: string | QueryRaw | undefined): string | undefined {
  return where instanceof QueryRaw ? rawSql(where, 'a partial-index predicate') : where;
}

/**
 * Index DDL is evaluated once at creation time, so it cannot take the dialect-aware callback form of
 * `raw()` - there is no query context to hand it, and no placeholder a `CREATE INDEX` could bind.
 */
function rawSql(value: QueryRaw, what = 'an index expression'): string {
  const sql = value[RAW_VALUE];
  if (typeof sql !== 'string') {
    throw new TypeError(`${what} needs raw() with no interpolation, not a function or a bound value`);
  }
  return sql;
}
