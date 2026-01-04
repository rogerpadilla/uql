import type { PoolClient } from '@neondatabase/serverless';
import { PostgresDialect } from '../postgres/index.js';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { QueryUpdateResult } from '../type/index.js';

export class NeonQuerier extends AbstractPoolQuerier<PoolClient> {
  constructor(connect: () => Promise<PoolClient>, extra?: any) {
    super(new PostgresDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    await this.lazyConnect();
    const res = await this.conn.query(query, values);
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    await this.lazyConnect();
    const res = await this.conn.query(query, values);
    const changes = res.rowCount ?? 0;
    const ids = res.rows.map((r: any) => r.id);
    return { changes, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  protected override async releaseConn(conn: PoolClient) {
    await conn.release();
  }
}
