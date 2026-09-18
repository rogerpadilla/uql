import {
  ColumnRef,
  type EntityIndexColumn,
  type EntityIndexMeta,
  type EntityMeta,
  type IndexColumnInput,
  type IndexColumnSchema,
  QueryRaw,
} from '../type/index.js';
import { definedEntries } from './object.util.js';
import { derivedIndexName } from './sql.util.js';

/**
 * Reduces an authored index entry to the form metadata keeps, so a column, an expression and an options
 * object reach the schema as one: a column read off the refs as its key, any other `raw` as it is.
 */
export function normalizeIndexColumn(entry: IndexColumnInput): EntityIndexColumn {
  const { column, ...modifiers } = typeof entry === 'string' || entry instanceof QueryRaw ? { column: entry } : entry;
  return { ...modifiers, column: column instanceof ColumnRef ? column.key : column };
}

/** Every index an entity declares: each `@Field({ index })` as the one-column `@Index` it is, then its `@Index`es. */
export function declaredIndexes<E>(meta: EntityMeta<E>): EntityIndexMeta<E>[] {
  const fieldIndexes = definedEntries(meta.fields).flatMap(([key, field]) =>
    field.index
      ? [
          {
            columns: [{ column: key }],
            name: typeof field.index === 'string' ? field.index : undefined,
            unique: field.unique,
          },
        ]
      : [],
  );
  return [...fieldIndexes, ...(meta.indexes ?? [])];
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

/** The name an index is created and read by: its own, else one derived from its table and its entries' columns. */
export function declaredIndexName(
  name: string | undefined,
  table: string,
  entries: readonly EntityIndexColumn[],
): string {
  return name ?? derivedIndexName(table, indexNameParts(entries));
}
