import { ISOLATION_LEVEL } from 'mssql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MsSqlDialect } from './mssqlDialect.js';
import { MsSqlQuerier } from './mssqlQuerier.js';

function buildRequest() {
  const request = {
    input: vi.fn(),
    query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    on: vi.fn(),
    cancel: vi.fn(),
    stream: false,
  };
  return request;
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

  /** `tedious` streams by event rather than by async iterator, so the rows are collected as they arrive. */
  it('should stream rows', async () => {
    // `internalStream` is reached through `findManyStream`, which connects first.
    await querier.all('SELECT 1');
    const handlers: Record<string, (arg?: unknown) => void> = {};
    request.on.mockImplementation((event: string, fn: (arg?: unknown) => void) => {
      handlers[event] = fn;
    });
    request.query.mockImplementation(() => {
      handlers['row']?.({ id: 1 });
      handlers['row']?.({ id: 2 });
      handlers['done']?.();
      return Promise.resolve();
    });

    const rows = [];
    for await (const row of querier.internalStream('SELECT * FROM "User"')) {
      rows.push(row);
    }

    expect(request.stream).toBe(true);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should surface a streaming failure', async () => {
    await querier.all('SELECT 1');
    const handlers: Record<string, (arg?: unknown) => void> = {};
    request.on.mockImplementation((event: string, fn: (arg?: unknown) => void) => {
      handlers[event] = fn;
    });
    request.query.mockImplementation(() => {
      handlers['error']?.(new Error('boom'));
      return Promise.resolve();
    });

    await expect(async () => {
      for await (const _row of querier.internalStream('SELECT 1')) {
        // the failure arrives before any row does
      }
    }).rejects.toThrow('boom');
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
