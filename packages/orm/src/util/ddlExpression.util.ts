import type { CheckSchema, EnumValues } from '../schema/types.js';
import {
  ColumnRef,
  type EntityIndexColumn,
  type EntityIndexMeta,
  type EntityMeta,
  type IndexColumnInput,
  type IndexColumnSchema,
  QuerySql,
} from '../type/index.js';
import { definedEntries } from './object.util.js';
import { sql } from './sql.js';
import { derivedIndexName, ownedName } from './sql.util.js';

/**
 * Reduces an authored index entry to the form metadata keeps, so a column, an expression and an options
 * object reach the schema as one: a column read off the refs as its key, any other `sql` as it is.
 */
export function normalizeIndexColumn(entry: IndexColumnInput): EntityIndexColumn {
  const { column, ...modifiers } = typeof entry === 'string' || entry instanceof QuerySql ? { column: entry } : entry;
  return { ...modifiers, column: column instanceof ColumnRef ? column.key : column };
}

/**
 * Every index an entity declares: each `@Field({ index })` or `@Field({ unique })` as the one-column
 * `@Index` it is, then its `@Index`es. A unique column is a unique index, the one spelling of uniqueness
 * every engine can add and drop.
 */
export function declaredIndexes<E>(meta: EntityMeta<E>): EntityIndexMeta<E>[] {
  const fieldIndexes = definedEntries(meta.fields).flatMap(([key, field]) =>
    field.index || field.unique
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
export function renderIndexColumn(
  entry: EntityIndexColumn,
  render: (statement: QuerySql) => string,
): IndexColumnSchema {
  const { column } = entry;
  return column instanceof QuerySql ? { ...entry, column: render(column), expression: true } : { ...entry, column };
}

/** What an unnamed index's name is built from: each entry's column, or `expr<n>` for an expression, which has none. */
export function indexNameParts(entries: readonly EntityIndexColumn[]): string[] {
  return entries.map((entry, at) => (typeof entry.column === 'string' ? entry.column : `expr${at}`));
}

/** The name an index is created and read by: its own, else one derived from its table, entries' columns and uniqueness. */
export function declaredIndexName(
  name: string | undefined,
  table: string,
  entries: readonly EntityIndexColumn[],
  unique = false,
): string {
  return name ?? derivedIndexName(table, indexNameParts(entries), unique);
}

/**
 * A check as uql installs it: named for its table and `label`, the author's name or `ck`, then a hash
 * of `expression`, so an edited check is a new name and reordering the checks renames none.
 */
export function ownedCheck(table: string, label: string | undefined, expression: string): CheckSchema {
  return { name: ownedName(table, label ?? 'ck', expression), expression };
}

/** The check a column's `enum` is, `column IN (...)`, each value the dialect's own literal; none without one. */
export function enumCheck(
  table: string,
  { name, enum: values }: { readonly name: string; readonly enum?: EnumValues },
  render: (statement: QuerySql) => string,
): CheckSchema[] {
  if (!values) {
    return [];
  }
  const statement = sql(({ ctx, dialect }) => {
    ctx.append(`${dialect.escapeId(name)} IN (`);
    values.forEach((value, i) => {
      ctx.append(i ? ', ' : '');
      ctx.addValue(value);
    });
    ctx.append(')');
  });
  return [ownedCheck(table, name, render(statement))];
}
