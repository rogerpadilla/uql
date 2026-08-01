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

/**
 * An index expression is DDL, evaluated once at creation time, so it cannot take the dialect-aware
 * callback form of `raw()` - there is no query context to hand it.
 */
function rawSql(value: QueryRaw): string {
  const sql = value[RAW_VALUE];
  if (typeof sql !== 'string') {
    throw new TypeError('an index expression needs raw() with a string, not a function');
  }
  return sql;
}
