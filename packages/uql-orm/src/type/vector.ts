import type { IndexType } from '../schema/types.js';

/**
 * Distance metrics supported by vector similarity search.
 * - `cosine` - best for text/LLM embeddings (default)
 * - `l2` - Euclidean distance
 * - `inner` - inner (dot) product
 * - `l1` - Manhattan distance
 * - `hamming` - for binary vectors
 */
export type VectorDistance = 'cosine' | 'l2' | 'inner' | 'l1' | 'hamming';

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
 * Augments an entity with the distance field projected by a vector-search `$sort.$project`. The
 * find methods return the plain entity, so annotate the result with this when you project a score:
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

/** Index types whose emitted DDL depends on the distance metric. */
export type VectorIndexType = Extract<IndexType, 'hnsw' | 'ivfflat' | 'vector'>;
