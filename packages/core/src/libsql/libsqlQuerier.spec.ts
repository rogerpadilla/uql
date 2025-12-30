import { beforeEach, describe, expect, it, jest } from 'bun:test';
import type { Client, ResultSet, Transaction } from '@libsql/client';
import { LibsqlQuerier } from './libsqlQuerier.js';

describe('LibsqlQuerier', () => {
  let mockClient: {
    execute: jest.Mock;
    transaction: jest.Mock;
    close: jest.Mock;
  };
  let mockTx: {
    execute: jest.Mock;
    commit: jest.Mock;
    rollback: jest.Mock;
    close: jest.Mock;
  };
  let querier: LibsqlQuerier;

  beforeEach(() => {
    mockTx = {
      execute: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      close: jest.fn(),
    };
    mockClient = {
      execute: jest.fn(),
      transaction: jest.fn().mockResolvedValue(mockTx),
      close: jest.fn(),
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
    } satisfies ResultSet);

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
    } satisfies ResultSet);

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
    mockTx.execute.mockResolvedValue({ rows: [], columns: [], columnTypes: [], rowsAffected: 0 } satisfies ResultSet);
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

  it('should release transaction resources', async () => {
    await querier.beginTransaction();
    await querier.internalRelease();
    expect(mockTx.close).toHaveBeenCalled();
  });
});
