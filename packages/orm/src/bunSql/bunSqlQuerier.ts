import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { SqlExecution } from '../util/sql.util.js';
import { type BunSqlConn, type BunSqlResult, bunSqlExecution } from './bunSql.util.js';

/**
 * A querier for `bun:sql` over a reserved connection, so raw SQL goes through `pool.sql` rather than
 * this. Streams through the base class, `bun:sql` having no cursors.
 */
export class BunSqlQuerier extends AbstractPoolQuerier<BunSqlConn> {
  /**
   * Through `.unsafe()`, which takes the compiled text where Bun's tagged template would parse its own: safe, as
   * every value is bound.
   */
  protected override async execute(sql: string, values?: unknown[]): Promise<SqlExecution> {
    return bunSqlExecution(await this.getConn().unsafe<BunSqlResult>(sql, values));
  }

  protected override async releaseConn(conn: BunSqlConn) {
    conn.release();
  }
}
