import type { VectorCast } from '../dialect/vectorCast.js';
import type { IndexType } from '../schema/types.js';
import { UqlUsageError } from '../util/uqlError.js';

/**
 * A vector search's metric: `cosine` (the default), `l2`, `inner` product or `l1`. No hamming: every
 * engine's takes a bit vector, which no field type maps to.
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

/** A vector search in `$sort`: `{ $sort: { embedding: { $vector: queryVec } }, $limit: 10 }`. */
export interface QueryVectorSearch extends QueryVectorQuery {
  /** Project the computed distance as a named field in the result. */
  readonly $project?: string;
}

/**
 * How a dialect spells a metric: an operator, or a function taking the metric by name where `metricArg`
 * says so, and `index`, how the dialect's vector index names it where it builds one. One map serves the
 * query and the index alike, so its keys say which metrics exist.
 */
export type VectorMetric =
  | { readonly op: string; readonly index: string }
  | { readonly fn: string; readonly metricArg?: string; readonly index?: string };

/** The error every dialect throws for a metric it lacks. */
export function unsupportedVectorMetric(
  dialectName: string,
  distance: VectorDistance,
  indexName?: string,
): UqlUsageError {
  const where = indexName === undefined ? '' : ` (index "${indexName}")`;
  return new UqlUsageError(`${dialectName} does not support vector distance metric: ${distance}${where}`);
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

/** The metric a search or an index measures by where nothing names one: every engine with vectors has it. */
export const DEFAULT_VECTOR_DISTANCE: VectorDistance = 'cosine';

/** The metric an index is built for: its own, else {@link DEFAULT_VECTOR_DISTANCE}. */
export function indexDistance(index: { readonly distance?: VectorDistance }): VectorDistance {
  return index.distance ?? DEFAULT_VECTOR_DISTANCE;
}

/**
 * What a vector index's DDL reads off the field it indexes, never declared on the index itself, so the
 * two cannot disagree. Absent for a non-vector index, and for one whose field is unknown.
 */
export type IndexedVectorField = {
  /** The field's vector type, which pgvector's operator classes are named after (`halfvec_cosine_ops`); `vector` where absent. */
  readonly vectorType?: VectorCast;
  /** The field's dimensions, which an Atlas vector search index states. */
  readonly dimensions?: number;
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
