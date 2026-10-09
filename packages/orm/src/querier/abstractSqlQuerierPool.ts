import type { AbstractSqlDialect } from '../dialect/index.js';
import type { QueryUpdateResult, RawRow, SqlQuerier, SqlQuerierPool, SqlStatement } from '../type/index.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';

/**
 * Base pool for SQL dialects; implements the raw-SQL surface of {@link SqlQuerierPool}, which owns
 * the connection-per-call semantics.
 */
export abstract class AbstractSqlQuerierPool<Q extends SqlQuerier, D extends AbstractSqlDialect>
  extends AbstractQuerierPool<Q, D>
  implements SqlQuerierPool<Q, D>
{
  all<T extends object = RawRow>(...statement: SqlStatement): Promise<T[]> {
    return this.withQuerier((querier) => querier.all<T>(...statement));
  }

  run(...statement: SqlStatement): Promise<QueryUpdateResult> {
    return this.withQuerier((querier) => querier.run(...statement));
  }
}
