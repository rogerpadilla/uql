import type { AbstractSqlDialect } from '../dialect/index.js';
import type {
  QueryRaw,
  QueryUpdateResult,
  RawRow,
  RawValue,
  SqlQuerier,
  SqlQuerierPool,
  SqlStatement,
} from '../type/index.js';
import { statementOf } from '../util/raw.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';

/**
 * Base pool for SQL dialects; implements the raw-SQL surface of {@link SqlQuerierPool}, which owns
 * the connection-per-call semantics.
 */
export abstract class AbstractSqlQuerierPool<Q extends SqlQuerier, D extends AbstractSqlDialect>
  extends AbstractQuerierPool<Q, D>
  implements SqlQuerierPool<Q, D>
{
  all<T extends object = RawRow>(strings: TemplateStringsArray, ...values: RawValue[]): Promise<T[]>;
  all<T extends object = RawRow>(sql: QueryRaw): Promise<T[]>;
  all<T extends object = RawRow>(...statement: SqlStatement): Promise<T[]> {
    const sql = statementOf(statement);
    return this.withQuerier((querier) => querier.all<T>(sql));
  }

  run(strings: TemplateStringsArray, ...values: RawValue[]): Promise<QueryUpdateResult>;
  run(sql: QueryRaw): Promise<QueryUpdateResult>;
  run(...statement: SqlStatement): Promise<QueryUpdateResult> {
    const sql = statementOf(statement);
    return this.withQuerier((querier) => querier.run(sql));
  }
}
