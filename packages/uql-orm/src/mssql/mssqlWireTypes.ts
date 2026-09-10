import type { RawRow } from '../type/index.js';
import { decodeWideNumber } from '../util/wideNumber.js';

/** The column metadata `tedious` reports beside a recordset, narrowed to the one field read here. */
type ColumnTypes = Record<string, { readonly type: unknown }>;

/**
 * Decode `BIGINT` as a JS number, leaving every other type to the driver.
 *
 * uql owes this to the caller because uql picks the column: `type: Number` maps to BIGINT (see
 * `schema/canonicalType.ts`), and `tedious` hands that back as a string to protect the digits past
 * 2^53 - so without this a field declared `number` reads back as `'9'`, including every generated
 * primary key on every entity.
 *
 * At the wire, for the reason `pgNumericTypes` gives: everything crosses it exactly once - entity
 * reads, the ids an `OUTPUT` reports, raw SQL, counts, aggregates - where the ORM's own hydration
 * only ever sees entity reads.
 *
 * By the rule every driver here shares, `decodeWideNumber`: a number where one is exact, the driver's
 * exact text past 2^53. The lighter escape hatch for a column that big is the declaration -
 * `@Field({ type: String, columnType: 'bigint' })`.
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
