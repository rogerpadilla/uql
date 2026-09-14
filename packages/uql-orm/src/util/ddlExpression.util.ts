import {
  ColumnRef,
  type EntityIndexColumn,
  type IndexColumnInput,
  type IndexColumnSchema,
  QueryRaw,
} from '../type/index.js';

/**
 * Reduces an authored index entry to the form metadata keeps, so a column, an expression and an options
 * object reach the schema as one: a column read off the refs as its key, any other `raw` as it is.
 */
export function normalizeIndexColumn(entry: IndexColumnInput): EntityIndexColumn {
  const { column, ...modifiers } = typeof entry === 'string' || entry instanceof QueryRaw ? { column: entry } : entry;
  return { ...modifiers, column: column instanceof ColumnRef ? column.key : column };
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
