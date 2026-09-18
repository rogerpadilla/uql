import { decodeWideNumber } from '../util/wideNumber.js';
import { decodeFloat32s, parseVectorLiteral, type VectorCast } from './vectorCast.js';

/**
 * How a stored column is decoded on read: the inverse of `AbstractSqlDialect.persistKind`. `json`
 * parses; a {@link VectorCast} says which literal; `boolean` undoes an engine with no boolean type,
 * `number` and `bigint` a driver that hands a wide integer or a decimal back as text, and `date` and
 * `bytes` a row that crossed JSON inside its parent's statement, which spells both as text. `float32` is
 * a vector bound as bytes (`DialectFeatures.vectorBytes`).
 */
export type HydrateKind = 'json' | 'boolean' | 'number' | 'bigint' | 'date' | 'bytes' | 'float32' | VectorCast;

/**
 * Decodes one non-null cell. A no-op where the driver already decoded it, since that varies per driver,
 * and untouched where it does not match its column's format.
 */
export function decodeColumn(value: unknown, kind: HydrateKind): unknown {
  return DECODERS[kind](value);
}

type Decoder = (value: unknown) => unknown;

/** A decoder of the text a driver returned; anything else it already decoded, and is kept. */
function fromText(decode: (text: string, value: unknown) => unknown): Decoder {
  return (value) => {
    const text = asText(value);
    return text === undefined ? value : decode(text, value);
  };
}

/** A vector's text in the literal its cast writes, or its packed float32s in hex, which MariaDB reads. */
function vectorDecoder(cast: VectorCast): Decoder {
  return fromText((text, value) =>
    text.startsWith(BYTES_PREFIX)
      ? decodeFloat32s(hexBytes(text.slice(BYTES_PREFIX.length)))
      : (parseVectorLiteral(text, cast) ?? value),
  );
}

const denseVector = vectorDecoder('vector');

/** A vector bound as bytes: packed float32s as a driver returns them, else hex or text, as JSON or an older row carries it. */
const float32Decoder: Decoder = (value) => {
  if (value instanceof ArrayBuffer) {
    return decodeFloat32s(new Uint8Array(value));
  }
  return value instanceof Uint8Array ? decodeFloat32s(value) : denseVector(value);
};

const DECODERS: Readonly<Record<HydrateKind, Decoder>> = {
  // 0/1 from SQLite's INTEGER or MySQL's TINYINT(1). Already a boolean on Postgres.
  boolean: (value) => (typeof value === 'boolean' ? value : Boolean(value)),
  date: (value) => (typeof value === 'string' ? (parseDate(value) ?? value) : value),
  // Only a string can be bytes that crossed JSON: bytes a driver already decoded stay as they are.
  bytes: (value) =>
    typeof value === 'string' && value.startsWith(BYTES_PREFIX) ? hexBytes(value.slice(BYTES_PREFIX.length)) : value,
  // A number too, not just text: `type: BigInt` is BIGINT, which the pg pools decode at the wire.
  bigint: (value) => {
    if (typeof value === 'bigint') {
      return value;
    }
    try {
      return BigInt(asText(value) ?? Number(value));
    } catch {
      // Not an integer after all (a fractional column declared `bigint`); keep what the driver gave.
      return value;
    }
  },
  number: fromText(decodeWideNumber),
  json: fromText((text, value) => {
    try {
      return JSON.parse(text);
    } catch {
      return value;
    }
  }),
  float32: float32Decoder,
  vector: denseVector,
  halfvec: vectorDecoder('halfvec'),
  sparsevec: vectorDecoder('sparsevec'),
};

/**
 * An ISO 8601 timestamp as a `Date`, its fraction cut to the milliseconds one holds, and a bare date at
 * local midnight, which is how `pg` reads a `date`. `undefined` for text that is neither.
 */
function parseDate(text: string): Date | undefined {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(text.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * What bytes crossing JSON start with, before two hex digits per byte: Postgres's own text for `bytea`,
 * which every dialect spells, so a string a driver reads from a column on its own is never mistaken.
 */
export const BYTES_PREFIX = '\\x';

/** Two hex digits per byte, back to bytes. */
function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let at = 0; at < bytes.length; at++) {
    bytes[at] = Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16);
  }
  return bytes;
}

/** Lazy so a consumer that never reads an encoded column never constructs one. */
let decoder: TextDecoder | undefined;

/** The text a driver returned, bytes included (`bun:sql` hands a MySQL decimal as a `Buffer`), or `undefined`. */
function asText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    decoder ??= new TextDecoder();
    return decoder.decode(value);
  }
  return undefined;
}
