import type { PoolConnection } from 'mariadb';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { RawRow } from '../type/index.js';
import { decodeBigInts } from '../util/wideNumber.js';

/** This driver binds only a `Buffer` as bytes: any other `Uint8Array` goes as the JSON of its indices. */
function toBindValues(values: unknown[] | undefined): unknown[] | undefined {
  return values?.map((value) =>
    value instanceof Uint8Array && !Buffer.isBuffer(value)
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : value,
  );
}

export class MariadbQuerier extends AbstractPoolQuerier<PoolConnection> {
  override async internalAll<T>(query: string, values?: unknown[]) {
    const rows: RawRow[] = await this.getConn().query(query, toBindValues(values));
    return Array.from(rows, decodeBigInts) as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, toBindValues(values));
    // An OK packet reports `affectedRows`; a `RETURNING` statement answers rows instead, and counts by them.
    const changes = res.affectedRows ?? res.length;
    const rows = res.length ? Array.from<RawRow, RawRow>(res, decodeBigInts) : [];
    return this.buildUpdateResult({ rows, changes, upsertStatus: res.affectedRows });
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const stream = this.getConn().queryStream(query, toBindValues(values));
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
