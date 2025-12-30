import { beforeEach, describe, expect, it, jest } from 'bun:test';
import type { PoolClient, QueryResult } from '@neondatabase/serverless';
import { NeonQuerier } from './neonQuerier.js';

describe('NeonQuerier', () => {
  let mockConn: {
    query: jest.Mock;
    release: jest.Mock;
  };
  let connect: jest.Mock;
  let querier: NeonQuerier;

  beforeEach(() => {
    mockConn = {
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [], command: '', oid: 0, fields: [] }),
      release: jest.fn(),
    };
    connect = jest.fn().mockResolvedValue(mockConn as unknown as PoolClient);
    querier = new NeonQuerier(connect);
  });

  it('should lazy connect on first query', async () => {
    mockConn.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 1 }],
      command: 'SELECT',
      oid: 0,
      fields: [],
    } satisfies QueryResult<any>);

    await querier.internalAll('SELECT * FROM users');

    expect(connect).toHaveBeenCalled();
    expect(mockConn.query).toHaveBeenCalledWith('SELECT * FROM users', undefined);
  });

  it('should run query and return changes', async () => {
    mockConn.query.mockResolvedValue({
      rowCount: 5,
      rows: [{ id: 10 }, { id: 11 }],
      command: 'INSERT',
      oid: 0,
      fields: [],
    } satisfies QueryResult<any>);

    const res = await querier.internalRun('INSERT INTO users ...');

    expect(res).toEqual({
      changes: 5,
      ids: [10, 11],
      firstId: 10,
    });
  });

  it('should release connection', async () => {
    await querier.lazyConnect();
    await querier.internalRelease();
    expect(mockConn.release).toHaveBeenCalled();
  });

  it('should not release if not connected', async () => {
    await querier.internalRelease();
    expect(mockConn.release).not.toHaveBeenCalled();
  });

  it('should throw if releasing with pending transaction', async () => {
    await querier.beginTransaction();
    expect(querier.internalRelease()).rejects.toThrow('pending transaction');
  });
});
