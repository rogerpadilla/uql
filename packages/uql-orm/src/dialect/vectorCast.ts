/**
 * Kept out of `schema/canonicalType.ts`: importing one function from that migration/codegen module
 * pulled all ~18 KB of its type-mapping tables into every consumer's bundle.
 */

import type { DialectName } from '../type/querier.js';

/** Vector cast types supported by pgvector. */
export type VectorCast = 'vector' | 'halfvec' | 'sparsevec';

/**
 * The dialects that have more than one vector column type. pgvector is the only one: `halfvec` and
 * `sparsevec` exist nowhere else (`HALFVEC(3)` is a syntax error on CockroachDB 26.2 and MariaDB 12.3,
 * not merely unsupported at runtime), so a field declaring one is stored - and therefore cast - as
 * plain `vector`. Both halves of that used to be stated separately, in this dialect layer and in the
 * migration type maps.
 */
export const MULTI_VECTOR_TYPE_DIALECTS: ReadonlySet<DialectName> = new Set<DialectName>(['postgres']);

/**
 * Whether a declared field type is a vector of any width. Every dialect that treats vectors specially
 * has to answer this for all three, not just `vector`: matching that one alone left `halfvec` and
 * `sparsevec` fields binding as plain arrays on insert and reading back raw.
 */
export function isVectorFieldType(type: unknown): boolean {
  return type === 'vector' || type === 'halfvec' || type === 'sparsevec';
}

/** Resolves the effective cast from field options, `columnType` taking priority over `type`. */
export function resolveVectorCast(field: { type?: unknown; columnType?: unknown } | undefined): VectorCast {
  const raw = field?.columnType ?? field?.type;
  if (raw === 'halfvec') return 'halfvec';
  if (raw === 'sparsevec') return 'sparsevec';
  return 'vector';
}

/**
 * pgvector's `sparsevec` literal: 1-based `index:value` pairs of the non-zero elements, then the
 * dimension count (`{1:1,3:2}/3`). A dense `[1,0,2]` is rejected outright by that type, so an entity
 * declaring `type: 'sparsevec'` still hands UQL the dense array its field type promises.
 */
export function toSparsevecLiteral(values: readonly unknown[]): string {
  const pairs = values
    .map((value, index) => `${index + 1}:${value}`)
    .filter((_, index) => Number(values[index]) !== 0)
    .join(',');
  return `{${pairs}}/${values.length}`;
}

/**
 * The inverse of the two literals above. pgvector hands a vector column back as **text**, so a read
 * that did not parse it returned a string from a field whose declared type is `number[]`: invisible
 * to the compiler, and invisible to any mocked test, because a mock returns the array the entity
 * promises. It surfaces only as arithmetic quietly producing nonsense on real rows.
 *
 * Driven by `cast`, never by the shape of the text, so this is the exact mirror of the write side:
 * a `sparsevec` column is read as `{1:1,3:2}/3` because that is what it was written as, and a dense
 * one as `[1,2,3]`. Both return the dense array the field type promises, whichever width the column
 * has. Sniffing the string instead would guess at a type the caller already knows.
 *
 * Returns `undefined` when the text does not match the column's own format, so a caller can keep the
 * raw value rather than replace it with something invented.
 */
export function parseVectorLiteral(raw: string, cast: VectorCast): number[] | undefined {
  const text = raw.trim();
  return cast === 'sparsevec' ? parseSparse(text) : parseDense(text);
}

const SPARSE_LITERAL = /^\{(.*)\}\/(\d+)$/;

/** `{1:1,3:2}/3` expanded to the dense array the field type promises, zeros included. */
function parseSparse(text: string): number[] | undefined {
  const sparse = SPARSE_LITERAL.exec(text);
  if (!sparse) return undefined;
  const dense = new Array<number>(Number(sparse[2])).fill(0);
  if (!sparse[1]) return dense;
  for (const pair of sparse[1].split(',')) {
    // Split into exactly two non-empty parts before converting: `Number('')` is 0, not NaN, so a
    // truncated `{1:}/3` would otherwise decode to a confident zero instead of being refused.
    const parts = pair.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    const [index, value] = parts.map(Number);
    if (!Number.isInteger(index) || index < 1 || index > dense.length || Number.isNaN(value)) return undefined;
    dense[index - 1] = value;
  }
  return dense;
}

/**
 * `[1,0,2]`, whatever width the column has.
 *
 * A dense literal is valid JSON by construction, so parsing it as JSON is both stricter and cheaper
 * than splitting: `[1,,2]` throws here, where `split(',').map(Number)` would have turned the hole
 * into a 0.
 */
function parseDense(text: string): number[] | undefined {
  if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
  try {
    const dense: unknown = JSON.parse(text);
    return Array.isArray(dense) && dense.every((n) => typeof n === 'number') ? (dense as number[]) : undefined;
  } catch {
    return undefined;
  }
}
