import type { AbstractSqlDialect } from '../dialect/index.js';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions, RawRow } from '../type/index.js';

export interface PgAnyClient {
  query(text: string, values?: unknown[]): Promise<{ rows: RawRow[]; rowCount: number | null }>;
  query(stream: object): AsyncIterable<RawRow> & { destroy(): void };
  release(): void | Promise<void>;
}

/**
 * Shared base class for Postgres-compatible queriers (standard pg, CockroachDB, Neon).
 */
export abstract class AbstractPgQuerier<
  C extends PgAnyClient,
  D extends AbstractSqlDialect,
> extends AbstractPoolQuerier<C> {
  constructor(connect: () => Promise<C>, dialect: D, extra?: ExtraOptions) {
    super(dialect, connect, extra);
  }

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

  protected override async releaseConn(conn: C) {
    await conn.release();
  }
}
