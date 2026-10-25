import type { CheckSchema, EnumValues } from '../schema/types.js';
import type { EntityIndexMeta, EntityMeta, IndexEntry, QuerySql } from '../type/index.js';
import { indexEntryNamePart } from './indexEntry.util.js';
import { definedEntries } from './object.util.js';
import { sql } from './sql.js';
import { derivedIndexName, ownedName } from './sql.util.js';

/**
 * Every index an entity declares: each `index()` or `unique()` column as the one-column
 * index it is, then its `indexes`. A unique column is a unique index, the one spelling of uniqueness
 * every engine can add and drop.
 */
export function declaredIndexes<E>(meta: EntityMeta<E>): EntityIndexMeta<E>[] {
  const fieldIndexes = definedEntries(meta.fields).flatMap(([key, field]) =>
    field.index || field.unique
      ? [
          {
            entries: [{ column: key }],
            name: typeof field.index === 'string' ? field.index : undefined,
            unique: field.unique,
          },
        ]
      : [],
  );
  return [...fieldIndexes, ...(meta.indexes ?? [])];
}

/**
 * An index's rendered predicate and the name it is created by, settled together: `render` gets the name without the
 * predicate's hash to label its errors, then the name takes the hash of what it rendered.
 */
export function namedIndex(
  name: string | undefined,
  table: string,
  entries: readonly IndexEntry<unknown>[],
  render: (label: string) => string | undefined,
  unique?: boolean,
): { readonly name: string; readonly where: string | undefined } {
  const where = render(declaredIndexName(name, table, entries, { unique }));
  return { name: declaredIndexName(name, table, entries, { unique, where }), where };
}

/**
 * The name an index is created and read by: its own, else one derived from its table, entries, uniqueness and
 * rendered predicate. A caller renders the predicate first, since an unnamed partial index's name carries its hash.
 */
export function declaredIndexName(
  name: string | undefined,
  table: string,
  entries: readonly IndexEntry<unknown>[],
  { unique = false, where }: { readonly unique?: boolean; readonly where?: string } = {},
): string {
  return name ?? derivedIndexName(table, entries.map(indexEntryNamePart), unique, where);
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
