import { type PgAnyClient, PgQuerier } from '../postgres/pgQuerier.js';
import type { BoundStatement, ExtraOptions, TransactionOptions } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import type { NeonDialect } from './neonDialect.js';

/** Neon over HTTP, what a statement goes through outside a session: one statement, or a list as one transaction. */
export type NeonHttp = {
  query(sql: string, values?: unknown[]): Promise<SqlExecution>;
  transaction(statements: readonly BoundStatement[]): Promise<SqlExecution[]>;
};

/**
 * Querier for Neon, over HTTP first: a statement is one request, and a list one request running it as a
 * transaction. A WebSocket session, opened for what one request cannot hold (a transaction a callback runs in, a
 * stream's loop), serves the querier until it is released.
 */
export class NeonQuerier extends PgQuerier {
  constructor(
    private readonly http: NeonHttp,
    connect: () => Promise<PgAnyClient>,
    dialect: NeonDialect,
    extra?: ExtraOptions,
  ) {
    super(connect, dialect, extra);
  }

  /** Connects nothing: a statement goes over HTTP until a session holds the connection. */
  protected override async lazyConnect() {
    this.assertActive();
  }

  protected override async execute(sql: string, values?: unknown[]): Promise<SqlExecution> {
    if (this.conn) {
      return super.execute(sql, values);
    }
    return this.http.query(sql, values);
  }

  /** A list as one HTTP transaction, all or none; inside an open transaction, pipelined on its session, which it joins. */
  protected override executeBatch(statements: readonly BoundStatement[]): Promise<SqlExecution[]> {
    return this.hasOpenTransaction ? super.executeBatch(statements) : this.http.transaction(statements);
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
