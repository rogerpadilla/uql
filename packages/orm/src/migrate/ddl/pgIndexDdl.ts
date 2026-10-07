import type { IndexColumnSchema, IndexSchema } from '../../type/index.js';
import { indexDistance } from '../../type/vector.js';
import { UqlUsageError } from '../../util/uqlError.js';
import { IndexDdl } from './indexDdl.js';

/** `CREATE INDEX ... USING hnsw ("embedding" vector_cosine_ops) WITH (m = ...)`, pgvector's form. */
export class PgIndexDdl extends IndexDdl {
  /** pgvector's own index types; CockroachDB's native one widens this. */
  protected isVectorIndex(index: IndexSchema): boolean {
    return index.type === 'hnsw' || index.type === 'ivfflat';
  }

  protected override indexAccessMethod(index: IndexSchema): string {
    if (index.type === 'fulltext') {
      return ' USING gin';
    }
    return this.usingType(index);
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
    const vectorType = this.dialect.supportedVectorType(index.vectorType ?? 'vector');
    const opsClass = `${vectorType}_${this.indexMetric(index)}_ops`;
    // IVFFlat has neither a sparsevec nor an L1 operator class; HNSW has all of them (pgvector 0.8.2).
    if (index.type === 'ivfflat' && (vectorType === 'sparsevec' || indexDistance(index) === 'l1')) {
      throw new UqlUsageError(`ivfflat has no ${opsClass} operator class (index "${index.name}"); use hnsw`);
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
  protected override isVectorIndex(index: IndexSchema): boolean {
    return index.type === 'vector' || super.isVectorIndex(index);
  }

  /** Its build-time candidate list alone: pgvector's `WITH (m = 16)` answers "invalid storage parameter", `hnsw` included. */
  protected override indexTuning(index: IndexSchema): string {
    return this.isVectorIndex(index) && index.efConstruction !== undefined
      ? ` WITH (build_beam_size = ${index.efConstruction})`
      : '';
  }
}
