import type { PoolConnection } from 'mariadb';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { extractInsertResult } from '../util/sql.util.js';
import { MariaDialect } from './mariaDialect.js';

export class MariadbQuerier extends AbstractPoolQuerier<PoolConnection> {
  constructor(connect: () => Promise<PoolConnection>, extra?: ExtraOptions) {
    super(new MariaDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res: T[] = await this.conn!.query(query, values);
    return res.slice(0, res.length);
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.conn!.query(query, values);
    return extractInsertResult(res.length ? res : [], res.affectedRows);
  }

  protected override async releaseConn(conn: PoolConnection) {
    await conn.release();
  }
}
