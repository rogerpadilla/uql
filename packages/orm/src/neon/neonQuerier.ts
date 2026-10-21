import type { CustomTypesConfig, NeonQueryFunction, PoolClient } from '@neondatabase/serverless';
import { pgExecution } from '../postgres/pgExecution.js';
import { PgQuerier } from '../postgres/pgQuerier.js';
import type { BoundStatement } from '../querier/index.js';
import type { ExtraOptions, TransactionOptions } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import type { NeonDialect } from './neonDialect.js';

/** Neon's HTTP query function, answering each statement's whole result: what a statement goes through outside a session. */
export type NeonHttp = NeonQueryFunction<false, true>;

/**
 * Querier for Neon, over HTTP first: a statement is one request, and a list one request running it as a
 * transaction. A WebSocket session, taken from the pool for what one request cannot hold (a transaction a
 * callback runs in, a stream's loop), serves the querier until it is released. Every query passes the pool's
 * `types` itself, since `neon()` ignores them, so a row decodes as it does over the session.
 */
export class NeonQuerier extends PgQuerier<PoolClient> {
  constructor(
    private readonly http: NeonHttp,
    private readonly types: CustomTypesConfig,
    connect: () => Promise<PoolClient>,
    dialect: NeonDialect,
    extra?: ExtraOptions,
  ) {
    super(connect, dialect, extra);
  }

  /** Connects nothing: a statement goes over HTTP until a session holds the connection. */
  protected override async lazyConnect() {
    this.assertActive();
  }

  protected override async execute(sql: string, values?: unknown[]) {
    if (this.conn) {
      return super.execute(sql, values);
    }
    return pgExecution(await this.http.query(sql, values, { types: this.types }));
  }

  /** A list as one HTTP transaction, all or none; inside an open transaction, in turn on its session, which it joins. */
  protected override async executeBatch(statements: readonly BoundStatement[]): Promise<SqlExecution[]> {
    if (this.hasOpenTransaction) {
      const results: SqlExecution[] = [];
      for (const { sql, values } of statements) {
        results.push(await super.execute(sql, values));
      }
      return results;
    }
    const results = await this.http.transaction(
      statements.map(({ sql, values }) => this.http.query(sql, values, { types: this.types })),
    );
    return results.map(pgExecution);
  }

  protected override async openTransaction(opts?: TransactionOptions) {
    await super.lazyConnect();
    await super.openTransaction(opts);
  }

  override async *internalStream(query: string, values?: unknown[]) {
    await super.lazyConnect();
    yield* super.internalStream(query, values);
  }
}
