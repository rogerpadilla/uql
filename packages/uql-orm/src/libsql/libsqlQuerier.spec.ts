import type { Client, ResultSet } from '@libsql/client';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { LibsqlQuerier } from './libsqlQuerier.js';

describe('LibsqlQuerier', () => {
  let mockClient: {
    execute: Mock<any>;
    transaction: Mock<any>;
    close: Mock<any>;
  };
  let mockTx: {
    execute: Mock<any>;
    commit: Mock<any>;
    rollback: Mock<any>;
    close: Mock<any>;
  };
  let querier: LibsqlQuerier;

  beforeEach(() => {
    mockTx = {
      execute: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      close: vi.fn(),
    };
    mockClient = {
      execute: vi.fn(),
      transaction: vi.fn().mockResolvedValue(mockTx),
      close: vi.fn(),
    };
    querier = new LibsqlQuerier(mockClient as unknown as Client);
  });

  it('should execute select query using client', async () => {
    mockClient.execute.mockResolvedValue({
      rows: [{ id: 1 }],
      columns: ['id'],
      columnTypes: ['INTEGER'],
      rowsAffected: 0,
      lastInsertRowid: undefined,
    } as unknown as ResultSet);

    const res = await querier.internalAll('SELECT 1');

    expect(mockClient.execute).toHaveBeenCalledWith({ sql: 'SELECT 1', args: undefined });
    expect(res).toEqual([{ id: 1 }]);
  });

  it('should execute INSERT and return IDs', async () => {
    mockClient.execute.mockResolvedValue({
      rows: [],
      columns: [],
      columnTypes: [],
      rowsAffected: 1,
      lastInsertRowid: 100n, // LibSQL uses bigint for rowid
    } as unknown as ResultSet);

    const res = await querier.internalRun('INSERT INTO ...');

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
    } as unknown as ResultSet);
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

  it('should close client on internalRelease', async () => {
    await querier.beginTransaction();
    await querier.internalRelease();
    expect(mockTx.close).toHaveBeenCalled();
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

  it('should throw error on rollbackTransaction without transaction', async () => {
    await expect(querier.rollbackTransaction()).rejects.toThrow(TypeError);
    await expect(querier.rollbackTransaction()).rejects.toThrow('not a pending transaction');
  });
});
