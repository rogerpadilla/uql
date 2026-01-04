import type { PoolClient } from 'pg';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { QueryUpdateResult } from '../type/index.js';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractPoolQuerier<PoolClient> {
  constructor(connect: () => Promise<PoolClient>, extra?: any) {
    super(new PostgresDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    await this.lazyConnect();
    const res = await this.conn.query<T>(query, values);
    return res.rows;
  }

  override async internalRun(query: string, values?: unknown[]) {
    await this.lazyConnect();
    const { rowCount: changes, rows = [] }: any = await this.conn.query(query, values);
    const ids = rows.map((r: any) => r.id);
    return { changes, ids, firstId: ids[0] } satisfies QueryUpdateResult;
  }

  protected override async releaseConn(conn: PoolClient) {
    await conn.release();
  }
}
