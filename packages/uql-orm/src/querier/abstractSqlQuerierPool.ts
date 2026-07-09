import type { AbstractSqlDialect } from '../dialect/index.js';
import type { QueryUpdateResult, SqlQuerier, SqlQuerierPool } from '../type/index.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';

/**
 * Base pool for SQL dialects; implements the raw-SQL surface of {@link SqlQuerierPool}, which owns
 * the connection-per-call semantics.
 */
export abstract class AbstractSqlQuerierPool<Q extends SqlQuerier, D extends AbstractSqlDialect>
  extends AbstractQuerierPool<Q, D>
  implements SqlQuerierPool<Q, D>
{
  all<T>(query: string, values?: unknown[]): Promise<T[]> {
    return this.withQuerier((querier) => querier.all<T>(query, values));
  }

  run(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    return this.withQuerier((querier) => querier.run(query, values));
  }
}
