import { Serialized } from '../querier/decorator/index.js';
import type { ExtraOptions, RawRow, TransactionOptions } from '../type/index.js';
import { throwNoPendingTransaction, throwPendingTransaction } from '../util/index.js';
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
  lastInsertRowid?: bigint;
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

  override async internalAll<T>(query: string, values?: unknown[]) {
    const target = this.tx || this.client;
    const res = await target.execute({ sql: query, args: values as HranaInValue[] });
    return res.rows as T[];
  }

  override async internalRun(query: string, values?: unknown[]) {
    const target = this.tx || this.client;
    const res = await target.execute({ sql: query, args: values as HranaInValue[] });
    const rows = res.rows as RawRow[];
    // `rowsAffected` is unreliably 0 whenever the statement has a RETURNING clause, so prefer
    // the actual row count when rows were returned.
    return this.buildUpdateResult({ rows, changes: rows.length || res.rowsAffected, id: res.lastInsertRowid });
  }

  override get hasOpenTransaction() {
    return !!this.tx;
  }

  @Serialized()
  override async beginTransaction(_opts?: TransactionOptions) {
    if (this.tx) {
      throwPendingTransaction();
    }
    this.tx = await this.client.transaction('write');
  }

  @Serialized()
  override async commitTransaction() {
    if (!this.tx) {
      throwNoPendingTransaction();
    }
    await this.tx.commit();
    this.tx = undefined;
  }

  @Serialized()
  override async rollbackTransaction() {
    if (!this.tx) {
      throwNoPendingTransaction();
    }
    await this.tx.rollback();
    this.tx = undefined;
  }

  override async internalRelease() {
    await super.internalRelease();
    if (this.closeClientOnRelease) {
      this.client.close();
    }
  }
}
