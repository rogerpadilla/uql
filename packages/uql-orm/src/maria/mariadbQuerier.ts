import type { PoolConnection } from 'mariadb';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import type { MariaDialect } from './mariaDialect.js';

export class MariadbQuerier extends AbstractPoolQuerier<PoolConnection> {
  constructor(connect: () => Promise<PoolConnection>, dialect: MariaDialect, extra?: ExtraOptions) {
    super(dialect, connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    return res as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    // MariaDB may not set `affectedRows` when RETURNING is used; fall back to row count.
    const changes = res.affectedRows ?? res.length ?? 0;
    return this.buildUpdateResult({ rows: res.length ? res : [], changes, upsertStatus: res.affectedRows });
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const stream = this.getConn().queryStream(query, values);
    try {
      for await (const row of stream) {
        yield row as T;
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
