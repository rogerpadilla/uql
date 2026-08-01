import { MysqlLikeSqlDialect } from '../dialect/mysqlLikeSqlDialect.js';
import type { IndexSchema } from '../type/index.js';

export class MySqlDialect extends MysqlLikeSqlDialect {
  override readonly dialectName = 'mysql';

  /**
   * MySQL has no vector index of any kind, so one is refused here rather than compiled to DDL the
   * server rejects: `USING hnsw` is a syntax error, and MariaDB's inline `VECTOR INDEX` is not MySQL
   * syntax either. Verified against MySQL 9.7, which does have `VECTOR` columns and
   * `STRING_TO_VECTOR`, but no distance function outside HeatWave - hence nothing to index for.
   */
  protected override indexAccessMethod(index: IndexSchema): string {
    if (index.type === 'vector' || index.type === 'hnsw' || index.type === 'ivfflat') {
      throw new TypeError(
        `${this.dialectName} has no vector index (index "${index.name}" declares type "${index.type}"). ` +
          'Vector search on MySQL needs HeatWave.',
      );
    }
    return super.indexAccessMethod(index);
  }
}
