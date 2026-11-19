import { type PgResult, pgExecution } from '../postgres/pgExecution.js';
import { AbstractSqlQuerier, type TransactionHandle } from '../querier/abstractSqlQuerier.js';
import { slotOf } from '../querier/transaction.js';
import type { ExtraOptions, TransactionOptions } from '../type/index.js';
import type { SqlExecution } from '../util/sql.util.js';
import type { PgliteDialect } from './pgliteDialect.js';

type Decode = (text: string) => unknown;

/** How one statement's rows decode, by type OID, over the handle's own parsers. */
export type PgliteQueryOptions = { readonly parsers: Readonly<Record<number, Decode>> };

/** What runs a statement on PGlite: the handle, or a transaction open on it. */
type PgliteExecutor = {
  query(query: string, params?: unknown[], options?: PgliteQueryOptions): Promise<PgResult>;
};

/**
 * The part of `@electric-sql/pglite` uql uses, stated so its published types do not depend on a pre-1.0 package:
 * a `PGlite`, or a `PGliteWorker` sharing one across tabs.
 */
export type PgliteDatabase = PgliteExecutor & {
  readonly parsers: Readonly<Partial<Record<number, Decode>>>;
  transaction<T>(run: (tx: PgliteOpenTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** A transaction PGlite runs a callback in. */
type PgliteOpenTransaction = PgliteExecutor & { rollback(): Promise<void> };

type PgliteTransaction = PgliteExecutor & TransactionHandle;

/**
 * Querier for PGlite, Postgres compiled to WASM and run in this process.
 *
 * @remarks Extends {@link AbstractSqlQuerier} rather than `PgQuerier`, whose stream needs `pg-query-stream`,
 * which PGlite's client cannot run.
 */
export class PgliteQuerier extends AbstractSqlQuerier<PgliteTransaction> {
  constructor(
    readonly db: PgliteDatabase,
    dialect: PgliteDialect,
    extra?: ExtraOptions,
    /** Passed with each statement on a handle the pool did not open, whose own parsers stay its owner's. */
    private readonly queryOptions?: PgliteQueryOptions,
  ) {
    super(dialect, extra);
  }

  /** Every querier of the pool is this one handle's session, so they share its transaction. */
  protected override get connection(): object {
    return this.db;
  }

  /** On the transaction its session holds, which only the flow holding it reaches here: every other waits its turn. */
  protected override async execute(sql: string, values?: unknown[]): Promise<SqlExecution> {
    const holder = slotOf(this.db).held?.scope.querier;
    const on = (holder instanceof PgliteQuerier && holder.tx) || this.db;
    return pgExecution(await on.query(sql, values, this.queryOptions));
  }

  /**
   * Through PGlite's own `transaction`, the one lock every caller of the handle respects, another tab's included.
   * One that cannot take its modes is rolled back, or its lock would hold the handle for good.
   */
  protected override async internalBegin(opts?: TransactionOptions) {
    const tx = await hold(this.db);
    const modes = this.dialect.transactionModes(opts);
    if (modes) {
      try {
        await tx.query(`SET TRANSACTION ${modes}`);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }
    this.tx = tx;
  }
}

/**
 * Opens a transaction on `db` that stays open until its handle ends it: PGlite's own runs a callback, which
 * waits here for the commit or rollback. PGlite commits it, refusing one a failed statement aborted.
 */
async function hold(db: PgliteDatabase): Promise<PgliteTransaction> {
  const opened = Promise.withResolvers<PgliteOpenTransaction>();
  const decided = Promise.withResolvers<boolean>();
  const ended = db.transaction(async (tx) => {
    opened.resolve(tx);
    if (!(await decided.promise)) {
      await tx.rollback();
    }
  });
  ended.catch(opened.reject);
  const tx = await opened.promise;
  const end = (commit: boolean) => {
    decided.resolve(commit);
    return ended;
  };
  return {
    query: (sql, values, options) => tx.query(sql, values, options),
    commit: () => end(true),
    rollback: () => end(false),
  };
}
