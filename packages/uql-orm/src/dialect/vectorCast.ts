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
