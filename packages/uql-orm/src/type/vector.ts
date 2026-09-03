import type { IndexType } from '../schema/types.js';

/**
 * Distance metrics supported by vector similarity search.
 * - `cosine` - best for text/LLM embeddings (default)
 * - `l2` - Euclidean distance
 * - `inner` - inner (dot) product
 * - `l1` - Manhattan distance
 *
 * @remarks Hamming distance is absent because no engine can express it over a float vector column:
 * pgvector's `<~>`/`bit_hamming_ops` and sqlite-vec's `vec_distance_hamming` both require a *bit*
 * vector, which no field type maps to. It would be a value that compiles and always throws.
 */
export type VectorDistance = 'cosine' | 'l2' | 'inner' | 'l1';

/**
 * Vector similarity search options - used inside `$sort` on vector fields.
 *
 * @example
 * ```ts
 * querier.findMany(Article, {
 *   $sort: { embedding: { $vector: queryVec } },
 *   $limit: 10,
 * });
 * ```
 */
export interface QueryVectorSearch {
  /** The query vector to compare against. */
  readonly $vector: readonly number[];
  /** Distance metric. Overrides entity-level default. Falls back to `'cosine'`. */
  readonly $distance?: VectorDistance;
  /** Project the computed distance as a named field in the result. */
  readonly $project?: string;
}

/**
 * Augments a row with the distance a vector-search `$sort.$project` computes, which is not
 * inferred. Wrap whatever the query returns - the entity, or a projected row:
 * ```ts
 * const results = (await querier.findMany(Article, {
 *   $sort: { embedding: { $vector: queryVec, $project: 'similarity' } },
 * })) as WithDistance<Article, 'similarity'>[];
 * ```
 */
export type WithDistance<E, K extends string = '_distance'> = E & Record<K, number>;

/**
 * Vector-specific tuning options shared by `@Index` decorator, entity metadata, and migration schema.
 */
export type VectorIndexOptions = {
  /** Distance metric for vector indexes - maps to operator class. */
  distance?: VectorDistance;
  /** HNSW: max connections per node. */
  m?: number;
  /** HNSW: construction search depth. */
  efConstruction?: number;
  /** IVFFlat: number of inverted lists. */
  lists?: number;
};

/**
 * Index types whose emitted DDL depends on the distance metric. The runtime list is the source, so
 * the type and every dialect's "do I have this one?" answer cannot drift from each other.
 */
export const VECTOR_INDEX_TYPES = ['hnsw', 'ivfflat', 'vector'] as const satisfies readonly IndexType[];

export type VectorIndexType = (typeof VECTOR_INDEX_TYPES)[number];

/** Whether an index type is one of {@link VECTOR_INDEX_TYPES}; narrows an optional `IndexSchema.type`. */
export function isVectorIndexType(type: IndexType | undefined): type is VectorIndexType {
  return type !== undefined && (VECTOR_INDEX_TYPES as readonly IndexType[]).includes(type);
}
