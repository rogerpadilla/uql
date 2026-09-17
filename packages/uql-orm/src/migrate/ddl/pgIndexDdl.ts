import { COCKROACH_VECTOR_METRICS, PG_VECTOR_METRICS } from '../../dialect/pgVectorMetrics.js';
import type { IndexType } from '../../schema/types.js';
import type { IndexColumnSchema, IndexFeature, IndexSchema } from '../../type/index.js';
import { unsupportedVectorMetric } from '../../type/vector.js';
import { IndexDdl } from './indexDdl.js';

/** `$text` computes its `TO_TSVECTOR` per row, which no index over the raw columns serves. */
const PG_INDEX_TYPE_HINTS: ReadonlyMap<IndexType, string> = new Map([
  ['fulltext', '. $text needs none there; name the columns it searches with $fields.'],
]);

/** `CREATE INDEX ... USING hnsw ("embedding" vector_cosine_ops) WITH (m = ...)`, pgvector's form. */
export class PgIndexDdl extends IndexDdl {
  /** Postgres 18's `pg_am`, with pgvector's two. */
  protected override readonly indexTypes = new Set<IndexType>([
    'btree',
    'hash',
    'gin',
    'gist',
    'brin',
    'hnsw',
    'ivfflat',
  ]);

  protected override readonly indexTypeHints = PG_INDEX_TYPE_HINTS;

  protected override readonly indexFeatures = new Set<IndexFeature>([
    'expression',
    'partial',
    'nullsOrder',
    'opsClass',
    'include',
    'jsonPath',
  ]);

  /** The metrics its vector index takes, each naming the operator class it is built with. */
  protected readonly vectorMetrics = PG_VECTOR_METRICS;

  /** pgvector's own index types; CockroachDB's native one widens this. */
  protected isVectorIndex(index: IndexSchema): boolean {
    return index.type === 'hnsw' || index.type === 'ivfflat';
  }

  protected override indexAccessMethod(index: IndexSchema): string {
    return index.type ? ` USING ${index.type}` : '';
  }

  /**
   * A vector index's operator class, `{type}_{metric}_ops` (`halfvec_cosine_ops`), refusing a metric it
   * lacks rather than build with the default; any other entry takes the class it declares.
   */
  protected override indexColumnOpsClass(entry: IndexColumnSchema, index: IndexSchema): string {
    if (!this.isVectorIndex(index) || !index.distance) {
      return entry.opsClass ? ` ${entry.opsClass}` : '';
    }
    const metric = this.vectorMetrics.get(index.distance);
    if (!metric) {
      throw unsupportedVectorMetric(this.dialect.dialectName, index.distance, index.name);
    }
    const vectorType = this.dialect.supportedVectorType(index.vectorType ?? 'vector');
    const opsClass = `${vectorType}_${metric.opsSuffix}_ops`;
    // IVFFlat has neither a sparsevec nor an L1 operator class; HNSW has all of them (pgvector 0.8.2).
    if (index.type === 'ivfflat' && (vectorType === 'sparsevec' || index.distance === 'l1')) {
      throw new TypeError(`ivfflat has no ${opsClass} operator class (index "${index.name}"); use hnsw`);
    }
    return ` ${opsClass}`;
  }

  protected override indexInclude(index: IndexSchema): string {
    return index.include?.length
      ? ` INCLUDE (${index.include.map((column) => this.dialect.escapeId(column)).join(', ')})`
      : '';
  }

  protected override indexTuning(index: IndexSchema): string {
    if (!this.isVectorIndex(index)) {
      return '';
    }
    const params: string[] = [];
    if (index.m !== undefined) params.push(`m = ${index.m}`);
    if (index.efConstruction !== undefined) params.push(`ef_construction = ${index.efConstruction}`);
    if (index.lists !== undefined) params.push(`lists = ${index.lists}`);
    return params.length > 0 ? ` WITH (${params.join(', ')})` : '';
  }
}

/** CockroachDB's native `CREATE VECTOR INDEX`, for `type: 'vector'`; it has neither `NULLS FIRST/LAST` nor `jsonb_path_ops`. */
export class CockroachIndexDdl extends PgIndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>(['expression', 'partial', 'include', 'jsonPath']);

  /** v26.3 answers `hash` and `brin` "unimplemented", `ivfflat` "unrecognized"; `hnsw` builds its vector index. */
  protected override readonly indexTypes = new Set<IndexType>(['btree', 'gin', 'gist', 'hnsw', 'vector']);

  protected override readonly indexTypeHints = new Map<IndexType, string>([
    ...PG_INDEX_TYPE_HINTS,
    ['ivfflat', "; declare type: 'vector' instead"],
  ]);

  protected override readonly vectorMetrics = COCKROACH_VECTOR_METRICS;

  private isNativeVectorIndex(index: IndexSchema): boolean {
    return index.type === 'vector';
  }

  protected override isVectorIndex(index: IndexSchema): boolean {
    return this.isNativeVectorIndex(index) || super.isVectorIndex(index);
  }

  protected override indexKeyword(index: IndexSchema): string {
    return this.isNativeVectorIndex(index) ? 'VECTOR INDEX' : super.indexKeyword(index);
  }

  protected override indexAccessMethod(index: IndexSchema): string {
    return this.isNativeVectorIndex(index) ? '' : super.indexAccessMethod(index);
  }

  /** None of pgvector's knobs: `WITH (m = 16)` answers "invalid storage parameter", `hnsw` included. */
  protected override indexTuning(): string {
    return '';
  }
}
