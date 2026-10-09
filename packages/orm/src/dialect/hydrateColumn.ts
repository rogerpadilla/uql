import { hexToBytes } from '../util/bytes.js';
import { decodeDate } from '../util/date.js';
import { decodeWideNumber } from '../util/wideNumber.js';
import { decodeFloat32s, parseVectorLiteral, type VectorCast } from './vectorCast.js';

/**
 * How a stored column is decoded on read: the inverse of `AbstractSqlDialect.persistKind`. `json`
 * parses; a {@link VectorCast} says which literal; `boolean` undoes an engine with no boolean type,
 * `number` and `bigint` a driver that hands a wide integer or a decimal back as text, `decimal` an exact
 * decimal read as its text, whatever the driver hands, and `date` and `bytes` a row that crossed JSON inside its parent's statement, which spells both as text. `float32` is
 * a vector bound as bytes (`DialectFeatures.vectorBytes`).
 */
export type HydrateKind =
  | 'json'
  | 'boolean'
  | 'number'
  | 'bigint'
  | 'decimal'
  | 'date'
  | 'bytes'
  | 'float32'
  | VectorCast;

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
      ? decodeFloat32s(hexToBytes(text.slice(BYTES_PREFIX.length)))
      : (parseVectorLiteral(text, cast) ?? value),
  );
}

const denseVector = vectorDecoder('vector');

/** A vector bound as bytes: packed float32s as a driver returns them, else the hex that crossed JSON. */
const float32Decoder: Decoder = (value) => {
  if (value instanceof ArrayBuffer) {
    return decodeFloat32s(new Uint8Array(value));
  }
  return value instanceof Uint8Array ? decodeFloat32s(value) : denseVector(value);
};

/** How a non-null cell of each kind decodes, keeping one already decoded or not in its kind's format. */
export const DECODERS: Readonly<Record<HydrateKind, Decoder>> = {
  // 0/1 from SQLite's INTEGER or MySQL's TINYINT(1). Already a boolean on Postgres.
  boolean: (value) => (typeof value === 'boolean' ? value : Boolean(value)),
  date: (value) => (typeof value === 'string' ? decodeDate(value) : value),
  // Only a string can be bytes that crossed JSON: bytes a driver already decoded stay as they are.
  bytes: (value) =>
    typeof value === 'string' && value.startsWith(BYTES_PREFIX) ? hexToBytes(value.slice(BYTES_PREFIX.length)) : value,
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
  decimal: (value) => asText(value) ?? String(value),
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
 * What bytes crossing JSON start with, before two hex digits per byte: Postgres's own text for `bytea`,
 * which every dialect spells, so a string a driver reads from a column on its own is never mistaken.
 */
export const BYTES_PREFIX = '\\x';

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
