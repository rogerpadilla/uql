import type { PoolClient } from '@neondatabase/serverless';
import { PostgresDialect } from '../postgres/index.js';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions } from '../type/index.js';
import { extractInsertResult } from '../util/sql.util.js';

export class NeonQuerier extends AbstractPoolQuerier<PoolClient> {
  constructor(connect: () => Promise<PoolClient>, extra?: ExtraOptions) {
    super(new PostgresDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.conn!.query(query, values);
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.conn!.query(query, values);
    return extractInsertResult(res.rows, res.rowCount ?? 0);
  }

  protected override async releaseConn(conn: PoolClient) {
    await conn.release();
  }
}
