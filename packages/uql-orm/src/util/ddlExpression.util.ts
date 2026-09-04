import { type IndexColumnInput, type IndexColumnSchema, QueryRaw, RAW_VALUE } from '../type/index.js';

/**
 * SQL bound for DDL, as the text a generator renders. `raw` with no interpolation, or a bare string
 * where one is still accepted: DDL is evaluated once at creation time, so there is no query context
 * for the callback form and no placeholder a `CREATE` statement could bind a value into.
 *
 * `what` names the thing being declared, so the error says which one the caller got wrong.
 */
export function ddlText(value: string | QueryRaw, what: string): string;
export function ddlText(value: string | QueryRaw | undefined, what: string): string | undefined;
export function ddlText(value: string | QueryRaw | undefined, what: string): string | undefined {
  if (!(value instanceof QueryRaw)) {
    return value;
  }
  const sql = value[RAW_VALUE];
  if (typeof sql !== 'string') {
    throw new TypeError(`${what} needs raw() with no interpolation, not a function or a bound value`);
  }
  return sql;
}

/**
 * Reduces an authored index entry to its normalized form, so the three shapes users write - a column
 * name, an expression, or an options object - reach the dialects as one.
 */
export function normalizeIndexColumn(entry: IndexColumnInput): IndexColumnSchema {
  if (typeof entry === 'string') {
    return { column: entry };
  }
  if (entry instanceof QueryRaw) {
    return { column: ddlText(entry, 'an index expression'), expression: true };
  }
  const { column, ...rest } = entry;
  return column instanceof QueryRaw
    ? { ...rest, column: ddlText(column, 'an index expression'), expression: true }
    : { ...rest, column };
}
