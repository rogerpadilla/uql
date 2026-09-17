import type { PoolClient, QueryResult } from '@neondatabase/serverless';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { PostgresDialect } from '../postgres/index.js';
import { PgQuerier } from '../postgres/pgQuerier.js';
import type { RawRow } from '../type/index.js';

describe('PgQuerier over a Neon client', () => {
  let mockConn: {
    query: Mock<(sql: string, params?: unknown[]) => Promise<QueryResult<RawRow>>>;
    release: Mock<() => void>;
  };
  let connect: Mock<() => Promise<PoolClient>>;
  let querier: PgQuerier;

  beforeEach(() => {
    mockConn = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [], command: '', oid: 0, fields: [] }),
      release: vi.fn(),
    };
    connect = vi.fn().mockResolvedValue(mockConn);
    querier = new PgQuerier(connect, new PostgresDialect());
  });

  it('should lazy connect on first query', async () => {
    mockConn.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 1 }],
      command: 'SELECT',
      oid: 0,
      fields: [],
    } satisfies QueryResult<RawRow>);

    await querier.all('SELECT * FROM users');

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
    } satisfies QueryResult<RawRow>);

    const res = await querier.run('INSERT INTO users ...');

    expect(res).toEqual({
      changes: 5,
      ids: [10, 11],
      firstId: 10,
    });
  });

  it('should release connection', async () => {
    await querier.all('SELECT 1');
    await querier.release();
    expect(mockConn.release).toHaveBeenCalledWith(false);
  });

  it('should not release if not connected', async () => {
    await querier.release();
    expect(mockConn.release).not.toHaveBeenCalled();
  });

  it('should roll back a pending transaction on release', async () => {
    await querier.beginTransaction();

    await expect(querier.release()).resolves.toBeUndefined();

    expect(querier.hasOpenTransaction).toBe(false);
    // The rollback succeeded, so the connection round-trips and goes back on the idle list.
    expect(mockConn.release).toHaveBeenCalledWith(false);
  });

  /**
   * A rollback that fails leaves a session state nothing here can name, so the connection must not be
   * reused. Handing pg any truthy argument is the only channel a driver has for saying so.
   */
  it('should discard the connection when the rollback fails', async () => {
    await querier.beginTransaction();
    mockConn.query.mockRejectedValueOnce(new Error('server went away mid-rollback'));

    await expect(querier.release()).resolves.toBeUndefined();

    expect(mockConn.release).toHaveBeenCalledWith(true);
  });

  it('should handle null rowCount gracefully', async () => {
    mockConn.query.mockResolvedValue({
      rowCount: null,
      rows: [{ id: 1 }],
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    const res = await querier.run('INSERT INTO users ...');

    expect(res).toEqual({
      changes: 0, // Falls back to 0 when rowCount is null
      ids: [1],
      firstId: 1,
    });
  });
});
