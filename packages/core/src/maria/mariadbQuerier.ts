import type { PoolConnection } from 'mariadb';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { QueryUpdateResult } from '../type/index.js';
import { MariaDialect } from './mariaDialect.js';

export class MariadbQuerier extends AbstractPoolQuerier<PoolConnection> {
  constructor(connect: () => Promise<PoolConnection>, extra?: any) {
    super(new MariaDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const res: T[] = await this.conn.query(query, values);
    return res.slice(0, res.length);
  }

  override async internalRun(query: string, values?: unknown[]) {
    this.extra?.logger?.(query, values);
    await this.lazyConnect();
    const res = await this.conn.query(query, values);
    const ids = res.length ? res.map((r: any) => r.id) : [];
    return { changes: res.affectedRows, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  protected override async releaseConn(conn: PoolConnection) {
    await conn.release();
  }
}
