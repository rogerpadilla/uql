import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import { decodeBigInts } from '../util/wideNumber.js';
import { type BunSqlConn, type BunSqlResult, getAffectedRows, getInsertId } from './bunSql.util.js';

/**
 * Querier for `bun:sql`, Bun's built-in driver for Postgres, MySQL, MariaDB and CockroachDB.
 *
 * @remarks Exposes no `SQL` of its own: the pool's would run a statement on any connection, outside
 * the transaction this one's reserved connection holds. Raw access is `pool.sql`. It streams through the
 * base class, `bun:sql` having no cursor API ([oven-sh/bun#17181](https://github.com/oven-sh/bun/issues/17181)).
 */
export class BunSqlQuerier extends AbstractPoolQuerier<BunSqlConn> {
  override async internalAll<T>(query: string, values?: unknown[]) {
    return Array.from(await this.execute(query, values), decodeBigInts) as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.execute(query, values);
    return this.buildUpdateResult({
      rows: Array.from(res, decodeBigInts),
      changes: getAffectedRows(res),
      id: getInsertId(res),
      upsertStatus: res.affectedRows ?? undefined,
    });
  }

  private async execute(query: string, values?: unknown[]): Promise<BunSqlResult> {
    // Safe: UQL parameters are strictly bound. .unsafe() correctly bypasses Bun's tagged template
    // literal parsing requirement so we can execute our dynamically compiled AST strings natively.
    return this.getConn().unsafe<BunSqlResult>(query, values);
  }

  protected override async releaseConn(conn: BunSqlConn) {
    conn.release();
  }
}
