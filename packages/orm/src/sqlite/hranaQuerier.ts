import { AbstractSqlQuerier, type BoundStatement } from '../querier/index.js';
import type { ExtraOptions, RawRow, TransactionOptions } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import { decodeBigInts } from '../util/wideNumber.js';
import { type SqliteBindValue, sqliteStatements, toBindValues } from './bindValues.js';
import type { SqliteDialect } from './sqliteDialect.js';

export type HranaInValue = SqliteBindValue | ArrayBuffer | Date;

export type HranaResultSet = {
  rows: unknown[];
  rowsAffected: number;
};

export type HranaStatement = { sql: string; args?: HranaInValue[] };

export type HranaExecutor = {
  execute(stmt: HranaStatement): Promise<HranaResultSet>;
};

/** An open transaction's handle: its own `batch` runs a list inside it, stopping at the first failure. */
export type HranaTransaction = HranaExecutor & {
  batch(stmts: HranaStatement[]): Promise<HranaResultSet[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

/**
 * The part of a Hrana client the querier uses: `@libsql/client` in any of its builds (`/web`,
 * `@libsql/client-wasm`). Declared here rather than imported, so a client the caller built fits
 * without the vendor's types.
 */
export type HranaClient = HranaExecutor & {
  /** Runs `stmts` as one request, all or none, in a transaction of `mode`. */
  batch(stmts: HranaStatement[], mode: 'write'): Promise<HranaResultSet[]>;
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
export class HranaQuerier extends AbstractSqlQuerier {
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
  protected override async execute(sql: string, values?: unknown[]) {
    return executionOf(await (this.tx ?? this.client).execute({ sql, args: toBindValues(values) }));
  }

  /** A list as one request: the client's `batch`, all or none; inside an open transaction, its own, which joins it. */
  protected override async executeBatch(statements: readonly BoundStatement[]) {
    const stmts = sqliteStatements(statements);
    const results = await (this.tx ? this.tx.batch(stmts) : this.client.batch(stmts, 'write'));
    return results.map(executionOf);
  }

  protected override async internalBegin(opts?: TransactionOptions) {
    this.tx = await this.client.transaction(opts?.readOnly ? 'read' : 'write');
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

/** A result set as the querier reads it: Hrana's rows, read by column name, their wide integers decoded. */
function executionOf({ rows, rowsAffected }: HranaResultSet): SqlExecution {
  return { rows: (rows as RawRow[]).map(decodeBigInts), changes: rowsAffected };
}
