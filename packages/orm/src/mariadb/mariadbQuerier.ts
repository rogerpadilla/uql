import type { Readable } from 'node:stream';
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
  /** A read, or a `RETURNING` write, answers rows, counted by them; any other write an OK packet reporting `affectedRows`. */
  protected override async execute(sql: string, values?: unknown[]) {
    const res = await this.getConn().query(sql, toBindValues(values));
    const rows = Array.isArray(res) ? Array.from<RawRow, RawRow>(res, decodeBigInts) : [];
    return { rows, changes: res.affectedRows };
  }

  /**
   * Closed through the driver's own `close`, which `Readable` does not type: a loop leaving early only destroys
   * the stream, which leaves the socket paused mid-result and the connection hung for its next statement.
   */
  override async *internalStream(query: string, values?: unknown[]) {
    const stream: Readable & { close?(): void } = this.getConn().queryStream(query, toBindValues(values));
    try {
      for await (const row of stream) {
        yield decodeBigInts(row);
      }
    } finally {
      stream.close?.();
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
