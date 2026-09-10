import { EventEmitter } from 'node:events';
import { ISOLATION_LEVEL, Request } from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MsSqlDialect } from './mssqlDialect.js';
import { MsSqlQuerier } from './mssqlQuerier.js';

function buildRequest() {
  return Object.assign(new EventEmitter(), {
    input: vi.fn(),
    query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stream: false,
    // The driver's own stream over the request's events, so the tests drive its real backpressure.
    toReadableStream: Request.prototype.toReadableStream,
  });
}

function buildTransaction(request: ReturnType<typeof buildRequest>) {
  return {
    begin: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockReturnValue(request),
  };
}

describe('MsSqlQuerier', () => {
  let request: ReturnType<typeof buildRequest>;
  let transaction: ReturnType<typeof buildTransaction>;
  let pool: { request: () => unknown; transaction: () => unknown };
  let querier: MsSqlQuerier;

  beforeEach(() => {
    request = buildRequest();
    transaction = buildTransaction(request);
    pool = { request: () => request, transaction: () => transaction };
    // No cast: what the querier asks of the pool is structural.
    querier = new MsSqlQuerier(async () => pool as never, new MsSqlDialect({}));
  });

  it('should bind values by name, matching the placeholders the dialect emits', async () => {
    request.query.mockResolvedValue({ recordset: [{ id: 1 }], rowsAffected: [1] });

    const rows = await querier.all('SELECT * FROM "User" WHERE "id" = @p1 AND "name" = @p2', [7, 'a']);

    expect(request.input).toHaveBeenNthCalledWith(1, 'p1', 7);
    expect(request.input).toHaveBeenNthCalledWith(2, 'p2', 'a');
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('should read the ids an OUTPUT clause reported', async () => {
    request.query.mockResolvedValue({ recordset: [{ id: 10 }, { id: 11 }], rowsAffected: [2] });

    const res = await querier.run('INSERT INTO "User" ("name") OUTPUT INSERTED."id" "id" VALUES (@p1), (@p2)');

    expect(res.ids).toEqual([10, 11]);
    expect(res.changes).toBe(2);
  });

  /** A `MERGE` reports one count per statement it ran, so what changed is their sum. */
  it('should sum the per-statement affected counts', async () => {
    request.query.mockResolvedValue({ recordset: [], rowsAffected: [1, 2] });

    expect((await querier.run('MERGE ...')).changes).toBe(3);
  });

  /**
   * The pool hands out a `Request` per call, so a `BEGIN TRANSACTION` sent as text would open one
   * on a connection the next call may not get. The commands are driven through `Transaction` instead.
   */
  it('should open a transaction through the driver rather than as a statement', async () => {
    await querier.beginTransaction();

    expect(transaction.begin).toHaveBeenCalledOnce();
    expect(request.query).not.toHaveBeenCalled();
    expect(querier.hasOpenTransaction).toBe(true);

    await querier.commitTransaction();

    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it('should bind a statement to the open transaction', async () => {
    await querier.beginTransaction();
    await querier.all('SELECT 1');

    expect(transaction.request).toHaveBeenCalled();
  });

  it('should roll back through the driver', async () => {
    await querier.beginTransaction();
    await querier.rollbackTransaction();

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  /** A querier handed back mid-transaction would otherwise leave one open on a pooled connection. */
  it('should roll back an open transaction when released', async () => {
    await querier.beginTransaction();
    await querier.release();

    expect(transaction.rollback).toHaveBeenCalled();
  });

  /** Emits `count` rows and the end, the way `tedious` does once the query is under way. */
  function emitRows(count: number) {
    request.query.mockImplementation(async () => {
      for (let id = 1; id <= count; id++) {
        request.emit('row', { id });
      }
      request.emit('done', {});
    });
  }

  it('should stream rows', async () => {
    // `internalStream` is reached through `findManyStream`, which connects first.
    await querier.all('SELECT 1');
    emitRows(2);

    const rows = [];
    for await (const row of querier.internalStream('SELECT * FROM "User"')) {
      rows.push(row);
    }

    expect(request.stream).toBe(true);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  /** Without it a slow loop holds every row the server sends, which is `all()` with extra steps. */
  it('should pause the request while the loop is behind', async () => {
    await querier.all('SELECT 1');
    emitRows(100);

    for await (const _row of querier.internalStream('SELECT * FROM "User"')) {
      break;
    }

    // Once as the stream is built, then again for each push the buffer refused.
    expect(request.pause.mock.calls.length).toBeGreaterThan(1);
  });

  it('should cancel the request when the loop stops early', async () => {
    await querier.all('SELECT 1');
    emitRows(100);

    for await (const _row of querier.internalStream('SELECT * FROM "User"')) {
      break;
    }

    expect(request.cancel).toHaveBeenCalledOnce();
  });

  it('should surface a streaming failure', async () => {
    await querier.all('SELECT 1');
    request.query.mockImplementation(async () => {
      request.emit('error', new Error('boom'));
    });

    await expect(async () => {
      for await (const _row of querier.internalStream('SELECT 1')) {
        // the failure arrives before any row does
      }
    }).rejects.toThrow('boom');
  });

  /** A failure reported through the promise alone would otherwise leave the loop waiting for rows. */
  it('should end the stream when the request rejects without an error event', async () => {
    await querier.all('SELECT 1');
    request.query.mockRejectedValue(new Error('connection closed'));

    await expect(async () => {
      for await (const _row of querier.internalStream('SELECT 1')) {
        // no row ever arrives
      }
    }).rejects.toThrow('connection closed');
  });

  /** Cancelling makes `mssql` report an error on a stream the loop has already left. */
  it('should absorb the error a cancel reports after the loop has gone', async () => {
    await querier.all('SELECT 1');
    emitRows(100);
    request.cancel.mockImplementation(() => request.emit('error', new Error('Canceled.')));

    for await (const _row of querier.internalStream('SELECT * FROM "User"')) {
      break;
    }

    expect(request.cancel).toHaveBeenCalledOnce();
  });

  /**
   * Sent as its own statement the level would land on whichever pooled connection served it, not the
   * one the transaction opens on, so it is handed to the driver with the `begin` instead.
   */
  it('should open the transaction at the isolation level asked for', async () => {
    await querier.beginTransaction({ isolationLevel: 'serializable' });

    expect(request.query).not.toHaveBeenCalled();
    expect(transaction.begin).toHaveBeenCalledWith(ISOLATION_LEVEL.SERIALIZABLE);
  });

  it('should leave the server default when no level is asked for', async () => {
    await querier.beginTransaction();

    expect(transaction.begin).toHaveBeenCalledWith(undefined);
  });
});
