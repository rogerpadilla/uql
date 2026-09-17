import type { ColumnNode, IndexNode } from './types.js';

/** The table columns an index's entries resolve to, in order; an expression entry resolves to none. */
export function indexColumns(index: IndexNode): ColumnNode[] {
  return index.entries.flatMap((entry) => (entry.expression ? [] : (index.table.columns.get(entry.column) ?? [])));
}
