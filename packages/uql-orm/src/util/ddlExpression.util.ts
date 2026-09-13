import { type EntityIndexColumn, type IndexColumnInput, type IndexColumnSchema, QueryRaw } from '../type/index.js';
import { entitySql } from './raw.js';

/**
 * Reduces an authored index entry to the form metadata keeps, so the shapes users write - a column
 * name, an expression's callback, an options object - reach the schema as one, each callback resolved.
 */
export function normalizeIndexColumn(entry: IndexColumnInput): EntityIndexColumn {
  if (typeof entry === 'string') {
    return { column: entry };
  }
  if (typeof entry === 'function') {
    return { column: entitySql(entry) };
  }
  const { column } = entry;
  return { ...entry, column: typeof column === 'function' ? entitySql(column) : column };
}

/** An index entry as the schema holds it, its expression rendered to text by `render`. */
export function renderIndexColumn(entry: EntityIndexColumn, render: (sql: QueryRaw) => string): IndexColumnSchema {
  const { column } = entry;
  return column instanceof QueryRaw ? { ...entry, column: render(column), expression: true } : { ...entry, column };
}

/** What an unnamed index's name is built from: each entry's column, or `expr<n>` for an expression, which has none. */
export function indexNameParts(entries: readonly EntityIndexColumn[]): string[] {
  return entries.map((entry, at) => (typeof entry.column === 'string' ? entry.column : `expr${at}`));
}
