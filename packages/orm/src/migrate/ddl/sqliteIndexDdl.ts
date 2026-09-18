import type { IndexColumnSchema, IndexSchema } from '../../type/index.js';
import { indexDistance, isVectorIndexType, unsupportedVectorMetric } from '../../type/vector.js';
import { IndexDdl } from './indexDdl.js';

/**
 * SQLite's `CREATE INDEX`, which names no index type. A vector index is libSQL's DiskANN where the dialect
 * can index its metric, and a plain index on an engine with none, so an entity written for Postgres migrates.
 */
export class SqliteIndexDdl extends IndexDdl {
  protected override indexColumn(entry: IndexColumnSchema, index: IndexSchema): string {
    const metric = this.vectorIndexMetric(index);
    if (metric === undefined) {
      return super.indexColumn(entry, index);
    }
    const options = [
      `metric=${metric}`,
      ...(index.m === undefined ? [] : [`max_neighbors=${index.m}`]),
      ...(index.efConstruction === undefined ? [] : [`insert_l=${index.efConstruction}`]),
    ];
    const args = [this.dialect.escapeId(entry.column), ...options.map((option) => this.dialect.escape(option))];
    return `libsql_vector_idx(${args.join(', ')})`;
  }

  /** The metric libSQL's index names, or `undefined` where the index is no vector index or the engine has none. */
  private vectorIndexMetric(index: IndexSchema): string | undefined {
    const { vectorMetrics, dialectName } = this.dialect;
    if (!isVectorIndexType(index.type) || !this.dialect.hasVectorIndex()) {
      return undefined;
    }
    const distance = indexDistance(index);
    const metric = vectorMetrics.get(distance)?.index;
    if (!metric) {
      throw unsupportedVectorMetric(dialectName, distance, index.name);
    }
    // Its tables are named after the index, unquoted: any other name fails with "unable to initialize diskann".
    if (!/^\w+$/.test(index.name) || index.entries.length !== 1) {
      throw new TypeError(
        `libSQL names a vector index only by letters, digits and underscores, over one column (index "${index.name}")`,
      );
    }
    return metric;
  }
}
