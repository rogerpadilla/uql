import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HranaQuerier } from './hranaQuerier.js';
import { SqliteDialect } from './sqliteDialect.js';

function buildTx() {
  return { execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), close: vi.fn() };
}

function buildClient(tx: ReturnType<typeof buildTx>) {
  return { execute: vi.fn(), transaction: vi.fn().mockResolvedValue(tx), close: vi.fn() };
}

describe('HranaQuerier', () => {
  let mockClient: ReturnType<typeof buildClient>;
  let mockTx: ReturnType<typeof buildTx>;
  let querier: HranaQuerier;

  beforeEach(() => {
    mockTx = buildTx();
    mockClient = buildClient(mockTx);
    // No cast: the querier's client contract is structural, so a plain mock satisfies it.
    querier = new HranaQuerier(mockClient, new SqliteDialect());
  });

  it('should execute select query using client', async () => {
    mockClient.execute.mockResolvedValue({
      rows: [{ id: 1 }],
      columns: ['id'],
      columnTypes: ['INTEGER'],
      rowsAffected: 0,
    });

    const res = await querier.internalAll('SELECT 1');

    expect(mockClient.execute).toHaveBeenCalledWith({ sql: 'SELECT 1', args: [] });
    expect(res).toEqual([{ id: 1 }]);
  });

  it('should execute INSERT and return IDs from a RETURNING clause', async () => {
    // SQLite's dialect appends RETURNING, so the driver reports the exact row(s), not a header id.
    // `rowsAffected` is unreliably 0 whenever RETURNING is present, so `rows.length` must be trusted.
    mockClient.execute.mockResolvedValue({
      rows: [{ id: 100 }],
      columns: ['id'],
      columnTypes: ['INTEGER'],
      rowsAffected: 0,
    });

    const res = await querier.internalRun('INSERT INTO ... RETURNING `id` `id`');

    expect(res).toEqual({
      changes: 1,
      ids: [100],
    });
  });

  it('should decode integers the client reads as bigints, exact past 2^53', async () => {
    mockClient.execute.mockResolvedValue({ rows: [{ id: 1n, big: 9007199254740993n }], rowsAffected: 0 });

    const res = await querier.internalAll('SELECT id, big FROM t');

    expect(res).toEqual([{ id: 1, big: '9007199254740993' }]);
  });

  it('should decode the ids a RETURNING statement reads as bigints', async () => {
    mockClient.execute.mockResolvedValue({ rows: [{ id: 100n }], rowsAffected: 0 });

    const res = await querier.internalRun('INSERT INTO ... RETURNING `id` `id`');

    expect(res).toEqual({ changes: 1, ids: [100] });
  });

  it('should run a transaction on the session the client opens', async () => {
    mockTx.execute.mockResolvedValue({
      rows: [],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
    });

    await querier.transaction(async () => {
      await querier.internalAll('SELECT 1');
    });

    expect(mockClient.transaction).toHaveBeenCalledWith('write');
    expect(mockTx.execute).toHaveBeenCalled();
    expect(mockClient.execute).not.toHaveBeenCalled();
    expect(mockTx.commit).toHaveBeenCalled();
  });

  it('should roll the session back when the callback throws', async () => {
    await expect(
      querier.transaction(async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');

    expect(mockTx.rollback).toHaveBeenCalled();
    expect(mockTx.commit).not.toHaveBeenCalled();
  });

  it('should roll the open transaction back on release', async () => {
    await querier.beginTransaction();
    await expect(querier.release()).resolves.toBeUndefined();

    expect(mockTx.rollback).toHaveBeenCalled();
    expect(mockTx.commit).not.toHaveBeenCalled();
  });

  it('should close client on internalRelease when closeClientOnRelease', async () => {
    const q = new HranaQuerier(mockClient, new SqliteDialect(), undefined, {
      closeClientOnRelease: true,
    });
    await q.internalRelease();
    expect(mockClient.close).toHaveBeenCalled();
  });
});
