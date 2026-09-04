import type { PgLikeSqlDialect } from '../../dialect/pgLikeSqlDialect.js';
import type { IndexColumnSchema, IndexFeature, IndexSchema } from '../../type/index.js';
import { unsupportedVectorMetric } from '../../type/vector.js';
import { IndexDdl } from './indexDdl.js';

/** `CREATE INDEX ... USING hnsw ("embedding" vector_cosine_ops) WITH (m = ...)`, pgvector's form. */
export class PgIndexDdl extends IndexDdl<PgLikeSqlDialect> {
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
    return index.type ? ` USING ${index.type}` : '';
  }

  /**
   * A vector index's operator class is named `{type}_{metric}_ops`: an index on a `halfvec` column
   * needs `halfvec_cosine_ops`, and `vector_cosine_ops` there is rejected outright. An unsupported
   * distance throws rather than being omitted, since a bare `USING hnsw ("embedding")` would build
   * with the dialect's default metric instead of the one requested, with nothing signalling it.
   * Everything else takes the operator class the entry declares, e.g. `jsonb_path_ops` for GIN.
   */
  protected override indexColumnOpsClass(entry: IndexColumnSchema, index: IndexSchema): string {
    if (!this.isVectorIndex(index) || !index.distance) {
      return entry.opsClass ? ` ${entry.opsClass}` : '';
    }
    const metric = this.dialect.vectorMetrics.get(index.distance);
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

/**
 * CockroachDB's vector index is native and has its own syntax: `CREATE VECTOR INDEX ... ("col"
 * vector_cosine_ops)`, with no access-method keyword, and tuning knobs of its own names that UQL
 * does not map. `type: 'vector'` is its trigger, the same generic value MariaDB's index uses.
 *
 * `NULLS FIRST/LAST` answers "unimplemented: this syntax" and `jsonb_path_ops` "operator class is
 * not supported" (both verified on v26.2), so neither is offered here.
 */
export class CockroachIndexDdl extends PgIndexDdl {
  protected override readonly indexFeatures = new Set<IndexFeature>(['expression', 'partial', 'include', 'jsonPath']);

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

  protected override indexTuning(index: IndexSchema): string {
    return this.isNativeVectorIndex(index) ? '' : super.indexTuning(index);
  }
}
