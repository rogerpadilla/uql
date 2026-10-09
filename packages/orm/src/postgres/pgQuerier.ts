import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { RawRow } from '../type/index.js';

export interface PgAnyClient {
  query(text: string, values?: unknown[]): Promise<{ rows: RawRow[]; rowCount: number | null }>;
  query(stream: object): AsyncIterable<RawRow>;
  on(event: 'error', listener: (err: Error) => void): unknown;
  removeListener(event: 'error', listener: (err: Error) => void): unknown;
  /** Any truthy argument makes `pg-pool` evict the client instead of returning it to the idle list. */
  release(discard?: boolean): void | Promise<void>;
}

const ignoreError = () => {};

/**
 * Querier for every client with node-postgres' API: `pg` itself, for Postgres and CockroachDB, and
 * Neon's serverless driver. Generic over the client alone - the dialect is whichever the pool built.
 */
export class PgQuerier<C extends PgAnyClient = PgAnyClient> extends AbstractPoolQuerier<C> {
  /**
   * A client the server drops while held emits `error` with no statement to report it to, which unheard ends
   * the process: the querier hears it while it holds the client, `pg-pool` while it idles, never both at once.
   */
  protected override acquired(conn: C): C {
    conn.on('error', ignoreError);
    return conn;
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const res = await this.getConn().query(query, values);
    return this.buildUpdateResult({ rows: res.rows, changes: res.rowCount ?? 0 });
  }

  override async *internalStream(query: string, values?: unknown[]) {
    const { default: QueryStream } = await import('pg-query-stream');
    yield* this.getConn().query(new QueryStream(query, values));
  }

  protected override async releaseConn(conn: C, discard: boolean) {
    conn.removeListener('error', ignoreError);
    await conn.release(discard);
  }
}
