import type { ColumnNode, IndexNode } from './types.js';

/**
 * The table columns an index resolves to, in order.
 *
 * Derived rather than stored: an index is defined by its entries, and a second field repeating them
 * as columns is a second thing to keep in step. It went out of step - one introspector rebuilt the
 * entries from the columns it had just built from the entries, and every fixture had to write both.
 * An expression entry resolves to no column at all, which is why the two were never the same list.
 */
export function indexColumns(index: IndexNode): ColumnNode[] {
  return index.entries.flatMap((entry) => (entry.expression ? [] : (index.table.columns.get(entry.column) ?? [])));
}
