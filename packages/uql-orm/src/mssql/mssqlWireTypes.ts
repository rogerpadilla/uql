import type { RawRow } from '../type/index.js';

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
 * Exact to 2^53, which covers any generated id. A value past it keeps the string the driver gave,
 * because a number could no longer represent it: that is the one case where handing back the exact
 * text is more useful than handing back the type that was asked for. The lighter escape hatch for a
 * column that big is the declaration - `@Field({ type: String, columnType: 'bigint' })`.
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
        const asNumber = Number(value);
        if (Number.isSafeInteger(asNumber)) {
          decoded[name] = asNumber;
        }
      }
    }
    return decoded as T;
  });
}

/** `tedious` reports a column's type as its factory function, whose `name` is the type's own. */
function typeName(type: unknown): string | undefined {
  return typeof type === 'function' ? type.name : undefined;
}
