/** Separates the parts of a composite key: a unit separator, which no column value carries. */
const KEY_SEPARATOR = '\u001f';

/**
 * A row's key over `columns`, for matching rows: read off the row, so a page builds no array per row, and
 * normalized rather than stringified, since `String(date)` depends on the locale.
 */
export function rowKey(row: unknown, columns: readonly string[]): string {
  const values = row as Record<string, unknown>;
  let key = '';
  for (let i = 0; i < columns.length; i++) {
    if (i) {
      key += KEY_SEPARATOR;
    }
    key += keyPart(values[columns[i]]);
  }
  return key;
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
