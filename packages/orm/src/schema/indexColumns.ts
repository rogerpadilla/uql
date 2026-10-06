import type { IndexColumnSchema } from '../type/index.js';
import type { ColumnNode, IndexNode, IndexType } from './types.js';

/** The table columns an index's entries resolve to, in order; an expression entry resolves to none. */
export function indexColumns(index: IndexNode): ColumnNode[] {
  return index.entries.flatMap((entry) => (entry.expression ? [] : (index.table.columns.get(entry.column) ?? [])));
}

/** Whether an entry is its column as stored, rather than an expression or a path the engine reprints in its own words. */
export function isColumnEntry(entry: IndexColumnSchema): boolean {
  return !entry.expression && !entry.jsonPath && !entry.jsonArray;
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
  const whole = index.entries.findIndex((entry) => !isColumnEntry(entry) || entry.length !== undefined);
  return index.entries.slice(0, whole === -1 ? undefined : whole).map((entry) => entry.column);
}
