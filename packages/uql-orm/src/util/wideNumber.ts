import type { RawRow } from '../type/index.js';

/**
 * A wide number as a JS number where that number is exact, and as its exact decimal text where it is
 * not - past 2^53, where a number silently rounds. The one rule every driver decodes a BIGINT by, and
 * hydration a numeric column a driver handed back as text: never a wrong number. `type: BigInt` is the
 * declared way to a typed exact integer.
 */
export function decodeWideNumber(value: string | bigint): number | string {
  const decoded = Number(value);
  return Math.abs(decoded) <= Number.MAX_SAFE_INTEGER ? decoded : String(value);
}

/**
 * {@link decodeWideNumber} over every `bigint` cell of a row, for the drivers that hand a BIGINT back
 * as one (`bun:sql` with `bigint: true`, `mariadb`). In place: the row is the driver's fresh object, and
 * a copy per row cost more than the decode it carried.
 */
export function decodeBigInts(row: RawRow): RawRow {
  for (const key in row) {
    const value = row[key];
    if (typeof value === 'bigint') {
      row[key] = decodeWideNumber(value);
    }
  }
  return row;
}
