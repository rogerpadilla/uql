import type { EntityMeta, FieldKey } from '../type/index.js';
import { entityName, getKeys, isRecord } from '../util/object.util.js';
import { UqlUsageError } from '../util/uqlError.js';

/** A sort key whose value a cursor carries, and whether that value may be null. */
export type CursorKey<E> = { readonly key: FieldKey<E>; readonly nullable: boolean };

/** Encodes the cursor for `row` as base64url JSON: the page's `fingerprint`, then each key's value. */
export function mintCursor<E>(
  meta: EntityMeta<E>,
  fingerprint: string,
  keys: readonly CursorKey<E>[],
  row: object,
): string {
  const values = keys.map(({ key }) => encodeValue(meta, key, Reflect.get(row, key)));
  return toBase64Url(JSON.stringify([fingerprint, ...values]));
}

/** Decodes the key values in `cursor`, refusing a cursor that no page with this sort minted. */
export function readCursor<E>(
  meta: EntityMeta<E>,
  fingerprint: string,
  keys: readonly CursorKey<E>[],
  cursor: string,
): unknown[] {
  const invalid = () => new UqlUsageError("not a cursor: pass a page's startCursor or endCursor as it came");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== keys.length + 1) {
    throw invalid();
  }
  const [minted, ...values] = parsed;
  if (minted !== fingerprint) {
    throw new UqlUsageError(`the cursor was not minted by a page of '${entityName(meta)}' sorted this way`);
  }
  return keys.map((key, at) => {
    const value = decodeValue(values[at]);
    if (value === undefined || (value === null && !key.nullable)) {
      throw invalid();
    }
    return value;
  });
}

/**
 * Encodes a row's value so JSON round-trips it exactly. A `Date` is tagged because JSON turns it into text,
 * which MongoDB and SQLite would compare as text; a `bigint` is tagged because JSON cannot represent it.
 */
function encodeValue<E>(meta: EntityMeta<E>, key: FieldKey<E>, value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return { d: value.toISOString() };
  }
  if (typeof value === 'bigint') {
    return { n: String(value) };
  }
  if (typeof value === 'object') {
    throw new UqlUsageError(
      `cannot page '${entityName(meta)}' by '${key}': a cursor carries scalars, and it holds an object`,
    );
  }
  return value;
}

/** Reverses {@link encodeValue}, returning `undefined` for anything it never writes. */
function decodeValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
  }
  const [tag, ...others] = getKeys(value);
  const text = value[tag];
  if (others.length || typeof text !== 'string') {
    return undefined;
  }
  if (tag === 'd') {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return tag === 'n' && WHOLE.test(text) ? BigInt(text) : undefined;
}

const WHOLE = /^-?\d+$/;

/** Encodes text as UTF-8 base64url with `btoa`, since `Buffer` is missing on browser and edge runtimes. */
function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reverses {@link toBase64Url}, throwing on input it never produces. */
function fromBase64Url(cursor: string): string {
  const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
