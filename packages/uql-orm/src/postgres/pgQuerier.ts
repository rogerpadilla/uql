import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { RawRow } from '../type/index.js';

export interface PgAnyClient {
  query(text: string, values?: unknown[]): Promise<{ rows: RawRow[]; rowCount: number | null }>;
  query(stream: object): AsyncIterable<RawRow> & { destroy(): void };
  /** Any truthy argument makes `pg-pool` evict the client instead of returning it to the idle list. */
  release(discard?: boolean): void | Promise<void>;
}

/**
 * Querier for every client with node-postgres' API: `pg` itself, for Postgres and CockroachDB, and
 * Neon's serverless driver. Generic over the client alone - the dialect is whichever the pool built.
 */
export class PgQuerier<C extends PgAnyClient = PgAnyClient> extends AbstractPoolQuerier<C> {
  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    return this.buildUpdateResult({ rows: res.rows, changes: res.rowCount ?? 0 });
  }

  override async *internalStream<T>(query: string, values?: unknown[]) {
    const { default: QueryStream } = await import('pg-query-stream');
    const stream = this.getConn().query(new QueryStream(query, values));
    try {
      for await (const row of stream) {
        yield row as T;
      }
    } finally {
      stream.destroy();
    }
  }

  protected override async releaseConn(conn: C, discard: boolean) {
    await conn.release(discard);
  }
}
