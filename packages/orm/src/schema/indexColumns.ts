import { entryColumns, wholeColumn } from '../util/indexEntry.util.js';
import type { ColumnNode, IndexNode, IndexType } from './types.js';

/** The table columns an index's entries resolve to, in order; an expression entry resolves to none. */
export function indexColumns(index: IndexNode): ColumnNode[] {
  return entryColumns(index.entries).flatMap((column) => index.table.columns.get(column) ?? []);
}

/** Whether an equality lookup reads each index type; the rest answer text, vector or range questions. Total, so a new type says. */
const ANSWERS_LOOKUP: Readonly<Record<IndexType, boolean>> = {
  btree: true,
  hash: true,
  gin: false,
  gist: false,
  brin: false,
  fulltext: false,
  hnsw: false,
  ivfflat: false,
  vector: false,
  vectorSearch: false,
};

/**
 * The columns an index can look every row up by, in order, as far as its entries are whole columns: none
 * where it holds only some rows (partial) or is of a type an equality lookup does not read.
 */
export function lookupColumns(index: IndexNode): string[] {
  if (index.where !== undefined || !ANSWERS_LOOKUP[index.type ?? 'btree']) {
    return [];
  }
  const columns: string[] = [];
  for (const entry of index.entries) {
    const column = wholeColumn(entry);
    if (column === undefined) {
      break;
    }
    columns.push(column);
  }
  return columns;
}
