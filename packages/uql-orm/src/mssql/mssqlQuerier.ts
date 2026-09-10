import { ISOLATION_LEVEL } from 'mssql';
import type { ConnectionPool, Request, Transaction } from 'mssql';
import { AbstractPoolQuerier } from '../querier/abstractPoolQuerier.js';
import type { IsolationLevel, QueryUpdateResult, RawRow, TransactionOptions } from '../type/index.js';
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
    const res = (await this.#request(values).query(query)) as unknown as MsSqlResult;
    return this.buildUpdateResult({
      // `rowsAffected` carries one entry per statement, and a `MERGE` upsert emits its `OUTPUT`
      // alongside the write, so the counts are summed rather than read at [0].
      changes: res.rowsAffected.reduce((total, count) => total + count, 0),
      rows: decodeWireTypes(res.recordset, res.recordset?.columns),
    });
  }

  /**
   * The driver's own stream over the request, which pauses the request while the loop is behind, so
   * rows arrive only as fast as they are read. A failure the driver reports through the promise alone
   * would leave the loop waiting for rows, so it ends the stream instead.
   */
  override async *internalStream<T>(query: string, values?: unknown[]) {
    const request = this.#request(values);
    const rows = request.toReadableStream();
    const completed = request.query(query).catch((err: unknown) => {
      rows.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    try {
      for await (const row of rows) {
        yield row as T;
      }
    } finally {
      // The cancel reports itself as an error on the stream, and the loop that would hear it is gone.
      rows.on('error', () => {});
      request.cancel();
      await completed;
    }
  }

  /**
   * `mssql` owns its pool and hands out a `Request` per call, so a `BEGIN TRANSACTION` sent as text
   * would open one on a connection the next call may not be given. Its `Transaction` object is the
   * only thing that pins them together, so the transaction is that object rather than statements, and
   * the level goes to its `begin`: sent as a statement it would land on whichever connection served it.
   */
  protected override async internalBegin(opts?: TransactionOptions) {
    const transaction = this.getConn().transaction();
    await transaction.begin(opts?.isolationLevel && ISOLATION_LEVEL[ISOLATION[opts.isolationLevel]]);
    this.#transaction = transaction;
  }

  protected override async internalCommit() {
    const transaction = this.#transaction;
    this.#transaction = undefined;
    await transaction?.commit();
  }

  protected override async internalRollback() {
    const transaction = this.#transaction;
    this.#transaction = undefined;
    await transaction?.rollback();
  }

  /** The pool owns the socket; releasing a querier only drops this one's claim on it. */
  protected override async releaseConn(_conn: ConnectionPool, _discard: boolean) {
    const transaction = this.#transaction;
    this.#transaction = undefined;
    // A querier handed back mid-transaction would otherwise leave it open on a pooled connection.
    await transaction?.rollback().catch(() => undefined);
  }
}

/** The driver's constant for each level UQL names; total, so a new level is a compile error here. */
const ISOLATION: Readonly<Record<IsolationLevel, keyof typeof ISOLATION_LEVEL>> = {
  'read uncommitted': 'READ_UNCOMMITTED',
  'read committed': 'READ_COMMITTED',
  'repeatable read': 'REPEATABLE_READ',
  serializable: 'SERIALIZABLE',
};
