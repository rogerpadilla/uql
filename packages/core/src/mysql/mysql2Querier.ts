import type { PoolConnection } from 'mysql2/promise';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { QueryUpdateResult } from '../type/index.js';
import { MySqlDialect } from './mysqlDialect.js';

export class MySql2Querier extends AbstractPoolQuerier<PoolConnection> {
  constructor(connect: () => Promise<PoolConnection>, extra?: any) {
    super(new MySqlDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const [res] = await this.conn.query(query, values);
    return res as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const [res]: any = await this.conn.query(query, values);
    const ids = res.insertId
      ? Array(res.affectedRows)
          .fill(res.insertId)
          .map((i, index) => i + index)
      : [];
    return { changes: res.affectedRows, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  protected override async releaseConn(conn: PoolConnection) {
    await conn.release();
  }
}
