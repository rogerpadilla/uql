/** Separates the parts of a composite key: a unit separator, which no column value carries. */
const KEY_SEPARATOR = '\u001f';

/**
 * A row's key as a string, for matching rows to each other in a `Map`.
 *
 * Values are normalized before joining, not stringified: `String(date)` is locale- and
 * timezone-dependent, so two equal dates could key apart, and a `Uint8Array` stringifies to its
 * bytes with commas. Every part is included, so two rows agreeing on one column of a composite key
 * are not treated as one row.
 */
export function rowKey(values: readonly unknown[]): string {
  return values.map(keyPart).join(KEY_SEPARATOR);
}

function keyPart(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  // Hex by hand rather than through `Buffer`, which is undefined on the browser and edge runtimes
  // this module reaches through `AbstractQuerier`.
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return String(value);
}
