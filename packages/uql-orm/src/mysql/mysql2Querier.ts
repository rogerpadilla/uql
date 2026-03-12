import type { FieldPacket, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { extractInsertResult } from '../util/sql.util.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractPoolQuerier<PoolConnection> {
  constructor(connect: () => Promise<PoolConnection>, extra?: ExtraOptions) {
    super(new MySqlDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const [res] = await this.conn!.query(query, values);
    return res as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const [res] = (await this.conn!.query(query, values)) as [ResultSetHeader, FieldPacket[]];
    const { insertId, affectedRows } = res;
    const ids = insertId
      ? Array(affectedRows)
          .fill(insertId)
          .map((i, index) => i + index)
      : [];
    return extractInsertResult(
      ids.map((id) => ({ id })),
      affectedRows,
      affectedRows,
    );
  }

  protected override async releaseConn(conn: PoolConnection) {
    await conn.release();
  }
}
