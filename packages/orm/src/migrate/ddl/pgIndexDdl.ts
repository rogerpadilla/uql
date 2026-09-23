import type { IndexType } from '../../schema/types.js';
import type { IndexColumnSchema, IndexFeature, IndexSchema } from '../../type/index.js';
import { indexDistance, unsupportedVectorMetric } from '../../type/vector.js';
import { IndexDdl } from './indexDdl.js';

/** `CREATE INDEX ... USING hnsw ("embedding" vector_cosine_ops) WITH (m = ...)`, pgvector's form. */
export class PgIndexDdl extends IndexDdl {
  /** Postgres 18's `pg_am`, with pgvector's two, and `fulltext`, which builds a `gin` one. */
  protected override readonly indexTypes = new Set<IndexType>([
    'btree',
    'hash',
    'gin',
    'gist',
    'brin',
    'hnsw',
    'ivfflat',
    'fulltext',
  ]);

  protected override readonly indexFeatures = new Set<IndexFeature>([
    'expression',
    'partial',
    'nullsOrder',
    'opsClass',
    'include',
    'jsonPath',
  ]);

  /** pgvector's own index types; CockroachDB's native one widens this. */
  protected isVectorIndex(index: IndexSchema): boolean {
    return index.type === 'hnsw' || index.type === 'ivfflat';
  }

  protected override indexAccessMethod(index: IndexSchema): string {
    if (index.type === 'fulltext') {
      return ' USING gin';
    }
    return index.type ? ` USING ${index.type}` : '';
  }

  /**
   * A vector index's operator class, `{type}_{metric}_ops` (`halfvec_cosine_ops`), refusing a metric it
   * lacks rather than build with the default; any other entry takes the class it declares. Stated even
   * for the default distance: pgvector's own default class is L2, which a cosine search never uses.
   */
  protected override indexColumnOpsClass(entry: IndexColumnSchema, index: IndexSchema): string {
    if (!this.isVectorIndex(index)) {
      return entry.opsClass ? ` ${entry.opsClass}` : '';
    }
    const distance = indexDistance(index);
    const metric = this.dialect.vectorMetrics.get(distance)?.index;
    if (!metric) {
      throw unsupportedVectorMetric(this.dialect.dialectName, distance, index.name);
    }
    const vectorType = this.dialect.supportedVectorType(index.vectorType ?? 'vector');
    const opsClass = `${vectorType}_${metric}_ops`;
    // IVFFlat has neither a sparsevec nor an L1 operator class; HNSW has all of them (pgvector 0.8.2).
    if (index.type === 'ivfflat' && (vectorType === 'sparsevec' || distance === 'l1')) {
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
  protected override readonly indexTypes = new Set<IndexType>(['btree', 'gin', 'gist', 'hnsw', 'vector', 'fulltext']);

  protected override readonly indexTypeHints = new Map<IndexType, string>([
    ['ivfflat', "; declare type: 'vector' instead"],
  ]);

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

  /** Its build-time candidate list alone: pgvector's `WITH (m = 16)` answers "invalid storage parameter", `hnsw` included. */
  protected override indexTuning(index: IndexSchema): string {
    return this.isVectorIndex(index) && index.efConstruction !== undefined
      ? ` WITH (build_beam_size = ${index.efConstruction})`
      : '';
  }
}
