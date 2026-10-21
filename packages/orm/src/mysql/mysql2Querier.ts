import type { PoolConnection } from 'mysql2';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';

/**
 * Holds the driver's own connection rather than its promise wrapper, whose types name the connection
 * inside it a promise one too: streaming is the own connection's alone.
 */
export class MySql2Querier extends AbstractPoolQuerier<PoolConnection> {
  /** A read answers its rows; a write, the header naming how many rows it changed and the first id it generated. */
  protected override async execute(sql: string, values?: unknown[]) {
    const [res] = await this.getConn().promise().query<RowDataPacket[] | ResultSetHeader>(sql, values);
    return Array.isArray(res) ? { rows: res } : { rows: [], changes: res.affectedRows, id: res.insertId };
  }

  override async *internalStream(query: string, values?: unknown[]) {
    yield* this.getConn().query(query, values).stream();
  }

  protected override async releaseConn(conn: PoolConnection, discard: boolean) {
    // mysql2 resets nothing on release, so a connection the pool takes back after a failed rollback
    // hands the next caller someone else's open transaction. `destroy` drops it from the pool instead.
    if (discard) {
      conn.destroy();
      return;
    }
    conn.release();
  }
}
