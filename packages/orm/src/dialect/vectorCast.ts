/**
 * Kept out of `schema/canonicalType.ts`: importing one function from that migration/codegen module
 * pulled all ~18 KB of its type-mapping tables into every consumer's bundle.
 */

/** Vector cast types supported by pgvector. */
export type VectorCast = 'vector' | 'halfvec' | 'sparsevec';

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
  const pairs = values.flatMap((value, index) => (Number(value) === 0 ? [] : [`${index + 1}:${value}`]));
  return `{${pairs.join(',')}}/${values.length}`;
}

/**
 * A vector column's text as the dense array its field promises (pgvector returns text), read by `cast`
 * as it was written, `{1:1,3:2}/3` or `[1,2,3]`; `undefined` where the text matches neither.
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

/** `[1,0,2]`, parsed as the JSON it is, which refuses a hole `split` would read as 0. */
function parseDense(text: string): number[] | undefined {
  if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
  try {
    const dense: unknown = JSON.parse(text);
    return Array.isArray(dense) && dense.every((n) => typeof n === 'number') ? (dense as number[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Packed little-endian float32s, each read as {@link shortestFloat32}. */
export function decodeFloat32s(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 4 }, (_, at) => shortestFloat32(view.getFloat32(at * 4, true)));
}

/**
 * `value` in the fewest significant digits that read back to it as a float32, by bisection: nine always
 * do, and a count past one that does nearly always does too, so at worst it keeps a digit it could drop.
 */
function shortestFloat32(value: number): number {
  let low = 1;
  let high = 9;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (Math.fround(Number(value.toPrecision(mid))) === value) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return Number(value.toPrecision(low));
}
