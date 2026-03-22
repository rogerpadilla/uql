import type { PoolClient } from 'pg';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions, RawRow } from '../type/index.js';
import { extractInsertResult } from '../util/sql.util.js';
import { PostgresDialect } from './postgresDialect.js';

export class PgQuerier extends AbstractPoolQuerier<PoolClient> {
  constructor(connect: () => Promise<PoolClient>, extra?: ExtraOptions) {
    super(new PostgresDialect(extra?.namingStrategy), connect, extra);
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.conn!.query<T & RawRow>(query, values);
    return res.rows;
  }

  override async internalRun(query: string, values?: unknown[]) {
    const { rowCount, rows = [] } = await this.conn!.query(query, values);
    return extractInsertResult(rows, rowCount ?? undefined);
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const { default: QueryStream } = await import('pg-query-stream');
    const stream = this.conn!.query(new QueryStream(query, values));
    try {
      for await (const row of stream) {
        yield row as T;
      }
    } finally {
      stream.destroy();
    }
  }

  protected override async releaseConn(conn: PoolClient) {
    await conn.release();
  }
}
