import { ISOLATION_LEVEL } from 'mssql';
import type { ConnectionPool, IIsolationLevel, Request, Transaction } from 'mssql';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { ExtraOptions, QueryUpdateResult, RawRow } from '../type/index.js';
import type { MsSqlDialect } from './mssqlDialect.js';
import { decodeWireTypes } from './mssqlWireTypes.js';

/** What `tedious` hands back for one statement, whichever shape it took. */
type MsSqlResult = {
  recordset?: RawRow[] & { columns?: Record<string, { type: unknown }> };
  rowsAffected: number[];
};

/**
 * A connection is a `ConnectionPool` handle here rather than a checked-out socket: `mssql` owns its
 * own pool and hands out `Request`s, so what UQL holds is the pool plus, once a transaction opens,
 * the `Transaction` every later request has to be bound to.
 */
export class MsSqlQuerier extends AbstractPoolQuerier<ConnectionPool> {
  #transaction?: Transaction;

  constructor(connect: () => Promise<ConnectionPool>, dialect: MsSqlDialect, extra?: ExtraOptions) {
    super(dialect, connect, extra);
  }

  /**
   * Values bind by name, `@p1` upward, matching {@link MsSqlDialect.placeholder}. `tedious` infers
   * a type from the JS value, which is why a `Date` and a `Uint8Array` reach it unconverted - the
   * inference is right for both, and wrong only for a bare `null`, which it calls `NVarChar`.
   */
  #request(values?: unknown[]): Request {
    const request = this.#transaction ? this.#transaction.request() : this.getConn().request();
    values?.forEach((value, index) => request.input(`p${index + 1}`, value));
    return request;
  }

  override async internalAll<T>(query: string, values?: unknown[]) {
    const res = (await this.#request(values).query(query)) as unknown as MsSqlResult;
    return decodeWireTypes(res.recordset as T[] | undefined, res.recordset?.columns);
  }

  override async internalRun(query: string, values?: unknown[]): Promise<QueryUpdateResult> {
    if (await this.#driveTransaction(query)) {
      return { changes: 0 };
    }
    const res = (await this.#request(values).query(query)) as unknown as MsSqlResult;
    return this.buildUpdateResult({
      // `rowsAffected` carries one entry per statement, and a `MERGE` upsert emits its `OUTPUT`
      // alongside the write, so the counts are summed rather than read at [0].
      changes: res.rowsAffected.reduce((total, count) => total + count, 0),
      rows: decodeWireTypes(res.recordset, res.recordset?.columns),
    });
  }

  /**
   * `tedious` streams by event, not by async iterator, so rows are handed over as they arrive rather
   * than collected first - buffering the whole result set would make this `all()` with extra steps.
   * The `query` promise is awaited at the end so its rejection surfaces rather than going unhandled.
   */
  override async *internalStream<T>(query: string, values?: unknown[]) {
    const request = this.#request(values);
    request.stream = true;

    let pending: T[] = [];
    let done = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;
    const arrived = () => {
      wake?.();
      wake = undefined;
    };

    request.on('row', (row: T) => {
      pending.push(row);
      arrived();
    });
    request.on('error', (err: Error) => {
      failure ??= err;
      arrived();
    });
    request.on('done', () => {
      done = true;
      arrived();
    });

    const completed = request.query(query).catch((err: unknown) => {
      failure ??= err instanceof Error ? err : new Error(String(err));
      arrived();
    });

    try {
      while (true) {
        if (pending.length) {
          const batch = pending;
          pending = [];
          yield* batch;
          continue;
        }
        if (failure) throw failure;
        if (done) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      // `completed` is awaited rather than left floating so a late rejection is handled; its own
      // `catch` has already recorded it, and the loop above is what raises one to the caller.
      request.cancel();
      await completed;
    }
  }

  /**
   * `mssql` owns its pool and hands out a `Request` per call, so a `BEGIN TRANSACTION` sent as text
   * would open one on a connection the next call may not be given. Its `Transaction` object is the
   * only thing that pins them together, so the three commands the dialect names are driven through
   * it here instead of being sent. Compared against the dialect's own strings rather than literals,
   * so renaming one cannot silently turn it back into text.
   */
  async #driveTransaction(query: string): Promise<boolean> {
    const { beginTransactionCommand, commitTransactionCommand, rollbackTransactionCommand } = this.dialect;
    if (query.startsWith(beginTransactionCommand)) {
      this.#transaction = this.getConn().transaction();
      await this.#transaction.begin(isolationLevelOf(query.slice(beginTransactionCommand.length)));
      return true;
    }
    if (query !== commitTransactionCommand && query !== rollbackTransactionCommand) {
      return false;
    }
    const transaction = this.#transaction;
    this.#transaction = undefined;
    await (query === commitTransactionCommand ? transaction?.commit() : transaction?.rollback());
    return true;
  }

  /** The pool owns the socket; releasing a querier only drops this one's claim on it. */
  protected override async releaseConn(_conn: ConnectionPool, _discard: boolean) {
    const transaction = this.#transaction;
    this.#transaction = undefined;
    // A querier handed back mid-transaction would otherwise leave it open on a pooled connection.
    await transaction?.rollback().catch(() => undefined);
  }
}

/**
 * The driver constant for the level the dialect spelled into its `BEGIN`, so it applies to the
 * connection the transaction actually opens on. Undefined leaves the server's own default.
 */
function isolationLevelOf(suffix: string): IIsolationLevel | undefined {
  const level = suffix
    .replace(/^\s*ISOLATION LEVEL\s*/i, '')
    .trim()
    .toUpperCase()
    .replaceAll(' ', '_');
  return level ? ISOLATION_LEVEL[level as keyof typeof ISOLATION_LEVEL] : undefined;
}
