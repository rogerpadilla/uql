import type { PoolConnection } from 'mariadb';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { RawRow } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';

export class MariadbQuerier extends AbstractPoolQuerier<PoolConnection> {
  override async internalAll<T>(query: string, values?: unknown[]) {
    const rows: RawRow[] = await this.getConn().query(query, values);
    return Array.from(rows, decodeBigInts) as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    // MariaDB may not set `affectedRows` when RETURNING is used; fall back to row count.
    const changes = res.affectedRows ?? res.length ?? 0;
    const rows = res.length ? Array.from<RawRow, RawRow>(res, decodeBigInts) : [];
    return this.buildUpdateResult({ rows, changes, upsertStatus: res.affectedRows });
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const stream = this.getConn().queryStream(query, values);
    try {
      for await (const row of stream) {
        yield decodeBigInts(row) as T;
      }
    } finally {
      stream.destroy();
    }
  }

  /**
   * No `discard` branch, unlike mysql2's: this driver resets the connection on release, so one taken
   * back mid-transaction rolls back rather than handing the next caller an open one. Verified on
   * 12.3 - same `threadId` on reacquire, `@@in_transaction` 0, the uncommitted row gone.
   */
  protected override async releaseConn(conn: PoolConnection) {
    await conn.release();
  }
}
