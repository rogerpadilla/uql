import type { ExtraOptions, RawRow } from '../type/index.js';
import { AbstractSqliteQuerier, type SqliteBindValue } from './abstractSqliteQuerier.js';
import type { SqliteDialect } from './sqliteDialect.js';

/**
 * Structural subset of the Hrana client API, the wire protocol shared by `@libsql/client` and
 * `@tursodatabase/serverless/compat`. Declared here rather than imported so a querier works with
 * any client of this shape (including `@libsql/client/web` and `@libsql/client-wasm`) without
 * depending on vendor types.
 */
export type HranaInValue = SqliteBindValue | ArrayBuffer | Date;

export type HranaResultSet = {
  rows: unknown[];
  rowsAffected: number;
};

export type HranaExecutor = {
  execute(stmt: { sql: string; args?: HranaInValue[] }): Promise<HranaResultSet>;
};

export type HranaTransaction = HranaExecutor & {
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

export type HranaClient = HranaExecutor & {
  transaction(mode?: 'write' | 'read' | 'deferred'): Promise<HranaTransaction>;
  close(): void;
};

/** Connection lifecycle for a {@link HranaQuerier} (separate from {@link ExtraOptions}). */
export type HranaQuerierConnectionOptions = {
  /** When set, {@link release} closes {@link HranaQuerier.client} (one-shot migration connections). */
  closeClientOnRelease?: boolean;
};

/**
 * Querier for SQLite databases reached through a Hrana client.
 *
 * @remarks Transactions use the client's own session handle rather than `BEGIN`/`COMMIT` statements,
 * because over plain HTTP consecutive requests need not share a connection.
 */
export class HranaQuerier extends AbstractSqliteQuerier {
  private tx?: HranaTransaction;
  private readonly closeClientOnRelease: boolean;

  constructor(
    readonly client: HranaClient,
    dialect: SqliteDialect,
    override readonly extra?: ExtraOptions,
    connection?: HranaQuerierConnectionOptions,
  ) {
    super(dialect, extra);
    this.closeClientOnRelease = connection?.closeClientOnRelease ?? false;
  }

  /** Runs on the open transaction's handle when there is one. */
  protected override async execute(query: string, values: SqliteBindValue[]) {
    const res = await (this.tx ?? this.client).execute({ sql: query, args: values });
    return { rows: res.rows as RawRow[], changes: res.rowsAffected };
  }

  protected override async internalBegin() {
    this.tx = await this.client.transaction('write');
  }

  /**
   * Both drop the handle before the call, not after: one that outlived a failed commit would carry
   * every later statement into a transaction the server may already have ended.
   */
  protected override async internalCommit() {
    const tx = this.tx;
    this.tx = undefined;
    await tx?.commit();
  }

  protected override async internalRollback() {
    const tx = this.tx;
    this.tx = undefined;
    await tx?.rollback();
  }

  override async internalRelease() {
    if (this.closeClientOnRelease) {
      this.client.close();
    }
  }
}
