import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import { decodeBigInts } from '../util/wideNumber.js';
import { type BunSqlConn, type BunSqlResult, getAffectedRows, getInsertId } from './bunSql.util.js';

/**
 * A querier for `bun:sql` over a reserved connection, so raw SQL goes through `pool.sql` rather than
 * this. Streams through the base class, `bun:sql` having no cursors.
 */
export class BunSqlQuerier extends AbstractPoolQuerier<BunSqlConn> {
  /**
   * Through `.unsafe()`, which takes the compiled text where Bun's tagged template would parse its own: safe, as
   * every value is bound.
   */
  protected override async execute(sql: string, values?: unknown[]) {
    const res = await this.getConn().unsafe<BunSqlResult>(sql, values);
    return { rows: Array.from(res, decodeBigInts), changes: getAffectedRows(res), id: getInsertId(res) };
  }

  protected override async releaseConn(conn: BunSqlConn) {
    conn.release();
  }
}
