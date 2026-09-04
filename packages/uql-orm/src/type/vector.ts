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
 * The vector and the metric: the half of a similarity search that names *what* distance to compute,
 * shared by `$sort`'s ranking ({@link QueryVectorSearch}) and `$where`'s threshold
 * ({@link QueryVectorNear}) so the two cannot describe the same distance differently.
 */
export interface QueryVectorQuery {
  /** The query vector to compare against. */
  readonly $vector: readonly number[];
  /** Distance metric. Overrides entity-level default. Falls back to `'cosine'`. */
  readonly $distance?: VectorDistance;
}

/** The keys that describe the search rather than bound it, so `$near`'s bounds are what is left. */
export const VECTOR_QUERY_KEYS = ['$vector', '$distance'] as const satisfies readonly (keyof QueryVectorQuery)[];

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
export interface QueryVectorSearch extends QueryVectorQuery {
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
 * How one dialect spells one distance metric. Two shapes exist across engines - an infix operator
 * (`"col" <=> $1`, pgvector) or a function call (`VEC_DISTANCE_COSINE(col, ?)`, MariaDB and the
 * SQLite family) - so they are one discriminated map rather than two parallel ones. That is what
 * lets a single `appendVectorSort` serve every engine, and makes the map's key set the one answer
 * to "does this dialect have this metric".
 *
 * `opsSuffix` rides along on the operator form because pgvector's index operator class is named from
 * the same metric (`vector_cosine_ops`): keeping them together is what stops a dialect from having
 * the operator but not the class it indexes with.
 */
export type VectorMetric = { readonly op: string; readonly opsSuffix: string } | { readonly fn: string };

/** The operator form, for the pgvector-family dialects whose index DDL also needs `opsSuffix`. */
export type VectorOperatorMetric = Extract<VectorMetric, { op: string }>;

/** Every dialect words this the same, and one of them used to throw a bare `Error` for it. */
export function unsupportedVectorMetric(dialectName: string, distance: VectorDistance, indexName?: string): TypeError {
  const where = indexName === undefined ? '' : ` (index "${indexName}")`;
  return new TypeError(`${dialectName} does not support vector distance metric: ${distance}${where}`);
}

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
