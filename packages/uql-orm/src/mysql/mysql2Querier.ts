import type { Connection } from 'mysql2';
import type { FieldPacket, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import type { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractPoolQuerier<PoolConnection> {
  constructor(connect: () => Promise<PoolConnection>, dialect: MySqlDialect, extra?: ExtraOptions) {
    super(dialect, connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const [res] = await this.conn!.query(query, values);
    return res as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const [res] = (await this.conn!.query(query, values)) as [ResultSetHeader, FieldPacket[]];
    return this.buildUpdateResult({
      changes: res.affectedRows,
      id: res.insertId,
      upsertStatus: res.affectedRows,
    });
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const rawConn = this.conn!.connection as unknown as Connection;
    const stream = rawConn.query(query, values).stream();
    try {
      for await (const row of stream) {
        yield row as T;
      }
    } finally {
      stream.destroy();
    }
  }

  protected override async releaseConn(conn: PoolConnection) {
    await conn.release();
  }
}
