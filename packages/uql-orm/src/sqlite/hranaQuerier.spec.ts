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
      lastInsertRowid: undefined,
    });

    const res = await querier.internalAll('SELECT 1');

    expect(mockClient.execute).toHaveBeenCalledWith({ sql: 'SELECT 1', args: undefined });
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
      lastInsertRowid: undefined,
    });

    const res = await querier.internalRun('INSERT INTO ... RETURNING `id` `id`');

    expect(res).toEqual({
      changes: 1,
      ids: [100],
      firstId: 100,
    });
  });

  it('should handle transactions', async () => {
    await querier.beginTransaction();
    expect(mockClient.transaction).toHaveBeenCalledWith('write');
    expect(querier.hasOpenTransaction).toBe(true);

    // Queries should now go through tx
    mockTx.execute.mockResolvedValue({
      rows: [],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
    });
    await querier.internalAll('SELECT 1');
    expect(mockTx.execute).toHaveBeenCalled();
    expect(mockClient.execute).not.toHaveBeenCalled();

    await querier.commitTransaction();
    expect(mockTx.commit).toHaveBeenCalled();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it('should rollback transaction', async () => {
    await querier.beginTransaction();
    await querier.rollbackTransaction();
    expect(mockTx.rollback).toHaveBeenCalled();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it('should roll the open transaction back on release', async () => {
    await querier.beginTransaction();

    await expect(querier.release()).resolves.toBeUndefined();

    expect(mockTx.rollback).toHaveBeenCalled();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it('should close client on internalRelease when closeClientOnRelease', async () => {
    const q = new HranaQuerier(mockClient, new SqliteDialect(), undefined, {
      closeClientOnRelease: true,
    });
    await q.internalRelease();
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('should throw error on double beginTransaction', async () => {
    await querier.beginTransaction();
    await expect(querier.beginTransaction()).rejects.toThrow(TypeError);
    await expect(querier.beginTransaction()).rejects.toThrow('pending transaction');
  });

  it('should throw error on commitTransaction without transaction', async () => {
    await expect(querier.commitTransaction()).rejects.toThrow(TypeError);
    await expect(querier.commitTransaction()).rejects.toThrow('not a pending transaction');
  });

  it('should ignore rollbackTransaction without transaction', async () => {
    await expect(querier.rollbackTransaction()).resolves.toBeUndefined();
    expect(querier.hasOpenTransaction).toBe(false);
  });
});
