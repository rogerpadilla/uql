import type { RawRow } from '../type/index.js';
import { decodeWideNumber } from '../util/wideNumber.js';

/** The column metadata `tedious` reports beside a recordset, narrowed to the one field read here. */
type ColumnTypes = Record<string, { readonly type: unknown }>;

/**
 * How a column of each type `tedious` mistranslates is read: a `BIGINT`, which it returns as text because
 * `type: Number` maps to BIGINT, by `decodeWideNumber`; a `UNIQUEIDENTIFIER`, which SQL Server returns in capitals,
 * lowercased to read back as every other engine does.
 */
const DECODERS = new Map<string, (value: string) => unknown>([
  ['BigInt', decodeWideNumber],
  ['UniqueIdentifier', (value) => value.toLowerCase()],
]);

/** Decodes the columns {@link DECODERS} names, at the wire, which every result crosses. */
export function decodeWireTypes<T>(rows: T[] | undefined, columns: ColumnTypes | undefined): T[] {
  if (!rows?.length || !columns) {
    return rows ?? [];
  }
  const decoded = Object.keys(columns).flatMap((name) => {
    const decode = DECODERS.get(typeName(columns[name]?.type));
    return decode ? [{ name, decode }] : [];
  });
  if (!decoded.length) {
    // The overwhelmingly common case, so an ordinary read copies nothing.
    return rows;
  }
  return rows.map((row) => {
    const values = { ...(row as RawRow) };
    for (const { name, decode } of decoded) {
      const value = values[name];
      if (typeof value === 'string') {
        values[name] = decode(value);
      }
    }
    return values as T;
  });
}

/** `tedious` reports a column's type as its factory function, whose `name` is the type's own. */
function typeName(type: unknown): string {
  return typeof type === 'function' ? type.name : '';
}
