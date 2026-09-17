import type { RawRow } from '../type/index.js';
import { decodeWideNumber } from '../util/wideNumber.js';

/** The column metadata `tedious` reports beside a recordset, narrowed to the one field read here. */
type ColumnTypes = Record<string, { readonly type: unknown }>;

/**
 * Decodes `BIGINT`, which `tedious` returns as text, by `decodeWideNumber`: `type: Number` maps to
 * BIGINT, so otherwise every generated key reads back as a string. At the wire, which every result crosses.
 */
export function decodeWireTypes<T>(rows: T[] | undefined, columns: ColumnTypes | undefined): T[] {
  if (!rows?.length || !columns) {
    return rows ?? [];
  }
  const wide = Object.keys(columns).filter((name) => typeName(columns[name]?.type) === 'BigInt');
  if (!wide.length) {
    // The overwhelmingly common case, so an ordinary read copies nothing.
    return rows;
  }
  return rows.map((row) => {
    const decoded = { ...(row as RawRow) };
    for (const name of wide) {
      const value = decoded[name];
      if (typeof value === 'string') {
        decoded[name] = decodeWideNumber(value);
      }
    }
    return decoded as T;
  });
}

/** `tedious` reports a column's type as its factory function, whose `name` is the type's own. */
function typeName(type: unknown): string | undefined {
  return typeof type === 'function' ? type.name : undefined;
}
