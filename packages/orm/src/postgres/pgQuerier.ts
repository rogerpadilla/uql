import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { BoundStatement, RawRow } from '../type/index.js';
import { noop } from '../util/object.util.js';
import type { SqlExecution } from '../util/sql.util.js';
import { type PgResult, pgExecution } from './pgExecution.js';
import { type PgTypes, pipelined } from './pgPipeline.js';

export interface PgAnyClient {
  query(text: string, values?: unknown[]): Promise<PgResult>;
  query(stream: object): AsyncIterable<RawRow>;
  getTypeParser: PgTypes['getTypeParser'];
  on(event: 'error', listener: (err: Error) => void): unknown;
  removeListener(event: 'error', listener: (err: Error) => void): unknown;
  /** Any truthy argument makes `pg-pool` evict the client instead of returning it to the idle list. */
  release(discard?: boolean): void | Promise<void>;
}

/**
 * Querier for every client with node-postgres' API: `pg` itself, for Postgres and CockroachDB, and
 * Neon's serverless driver; the dialect is whichever the pool built.
 */
export class PgQuerier extends AbstractPoolQuerier<PgAnyClient> {
  /**
   * A client the server drops while held emits `error` with no statement to report it to, which unheard ends
   * the process: the querier hears it while it holds the client, and what it hands the client back to after it.
   */
  protected override acquired(conn: PgAnyClient): PgAnyClient {
    conn.on('error', noop);
    return conn;
  }

  protected override async execute(sql: string, values?: unknown[]): Promise<SqlExecution> {
    return pgExecution(await this.getConn().query(sql, values));
  }

  /**
   * `statements` as one request: written ahead of one `Sync`, so they cost one round trip. Outside a transaction they
   * run in one opened and committed in the same request, all or none, which also scopes a setting bound for the
   * database's policies, as CockroachDB scopes one only in a transaction; rolled back where one fails.
   */
  protected override async executeBatch(statements: readonly BoundStatement[]): Promise<SqlExecution[]> {
    const conn = this.getConn();
    if (this.hasOpenTransaction) {
      return (await pipelined(conn, statements)).map(pgExecution);
    }
    const { dialect } = this;
    const begin = dialect.getBeginTransactionStatements().map((sql) => ({ sql, values: [] }));
    const listed = [...begin, ...statements, { sql: dialect.commitTransactionCommand, values: [] }];
    try {
      return (await pipelined(conn, listed, begin.length)).slice(begin.length, -1).map(pgExecution);
    } catch (error) {
      // The failed transaction stays open past the `Sync`; its own failure is the one worth reporting.
      await conn.query(dialect.rollbackTransactionCommand).catch(noop);
      throw error;
    }
  }

  override async *internalStream(query: string, values?: unknown[]) {
    const { default: QueryStream } = await import('pg-query-stream');
    yield* this.getConn().query(new QueryStream(query, values));
  }

  protected override async releaseConn(conn: PgAnyClient, discard: boolean) {
    conn.removeListener('error', noop);
    await conn.release(discard);
  }
}
