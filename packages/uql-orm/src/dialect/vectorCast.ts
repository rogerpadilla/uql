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
