import { parseVectorLiteral, type VectorCast } from './vectorCast.js';

/**
 * How a stored column is decoded on read: the inverse of `AbstractSqlDialect.persistKind`. `json`
 * parses; a {@link VectorCast} says which literal; `boolean` undoes an engine with no boolean type,
 * `number` and `bigint` a driver that hands a wide integer or a decimal back as text.
 */
export type HydrateKind = 'json' | 'boolean' | 'number' | 'bigint' | VectorCast;

/**
 * Decode one non-null cell. Kept beside {@link HydrateKind} rather than inlined into the querier's
 * row walk, so classifying a column and decoding it stay one subject in one file.
 *
 * Every branch is a no-op on a value the driver already decoded, because which types arrive as text
 * varies per driver and the entity is the only thing that says what they were meant to be. A value
 * that does not match its column's format is returned untouched rather than replaced by a guess.
 */
export function decodeColumn(value: unknown, kind: HydrateKind): unknown {
  if (kind === 'boolean') {
    // 0/1 from SQLite's INTEGER or MySQL's TINYINT(1). Already a boolean on Postgres.
    return typeof value === 'boolean' ? value : Boolean(value);
  }

  const text = asText(value);

  if (kind === 'bigint') {
    if (typeof value === 'bigint') {
      return value;
    }
    try {
      // A number, not just text: `type: BigInt` is BIGINT, which the pg pools decode at the wire.
      return BigInt(text ?? (value as number));
    } catch {
      // Not an integer after all (a fractional column declared `bigint`); keep what the driver gave.
      return value;
    }
  }

  // Everything below decodes text; anything else the driver already returned correctly.
  if (text === undefined) {
    return value;
  }

  if (kind === 'number') {
    const decoded = Number(text);
    return Number.isNaN(decoded) ? value : decoded;
  }

  if (kind === 'json') {
    try {
      return JSON.parse(text);
    } catch {
      // Keep the original value when the driver returns non-JSON text.
      return value;
    }
  }

  return parseVectorLiteral(text, kind) ?? value;
}

/** Lazy so a consumer that never reads an encoded column never constructs one. */
let decoder: TextDecoder | undefined;

/**
 * The text a driver returned, or `undefined` when it returned something already decoded.
 *
 * Bytes count as text: `bun:sql` hands a MySQL DECIMAL, and any `SUM` over one, back as a `Buffer`,
 * so a string-only check left those as raw bytes. `TextDecoder` rather than `Buffer.toString`, because
 * this module is reachable from the browser entry and may not name a Node builtin.
 */
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
