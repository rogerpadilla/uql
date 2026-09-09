/** Separates the parts of a composite key: a unit separator, which no column value carries. */
const KEY_SEPARATOR = '\u001f';

/**
 * A row's key as a string, for matching rows to each other in a {@link dataKeyed} lookup.
 *
 * Reads the columns off the row rather than taking their values, because every caller matches a
 * whole page of rows against one fixed column list: taking an array would make each of them build
 * one per row, which is what a page of 250 rows paid 56 KB for.
 *
 * Values are normalized before joining, not stringified: `String(date)` is locale- and
 * timezone-dependent, so two equal dates could key apart, and a `Uint8Array` stringifies to its
 * bytes with commas. Every column is included, so two rows agreeing on one column of a composite
 * key are not treated as one row.
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

/**
 * A lookup keyed by data rather than by a name this code chose, so a key that spells `__proto__` or
 * `constructor` is an ordinary entry instead of the prototype: on `{}` those threw when a bucket was
 * pushed to, and a `_count` tally under one silently read back as an object. Cheaper than a `Map`
 * here, and faster than `{}`, which walks the prototype chain on every miss.
 *
 * It carries none of `Object.prototype`, which no type can say: index it and spread it, but calling
 * `hasOwnProperty` on one type-checks and throws.
 */
export function dataKeyed<V>(): Record<string, V> {
  return Object.create(null);
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
