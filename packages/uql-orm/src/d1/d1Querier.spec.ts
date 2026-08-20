import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteDialect } from '../sqlite/index.js';
import { D1Querier, type D1Result } from './d1Querier.js';

function buildStmt() {
  return { bind: vi.fn().mockReturnThis(), all: vi.fn(), run: vi.fn() };
}

function buildDb(stmt: ReturnType<typeof buildStmt>) {
  return { prepare: vi.fn().mockReturnValue(stmt) };
}

describe('D1Querier', () => {
  let mockDb: ReturnType<typeof buildDb>;
  let mockStmt: ReturnType<typeof buildStmt>;
  let querier: D1Querier;

  beforeEach(() => {
    mockStmt = buildStmt();
    mockDb = buildDb(mockStmt);
    querier = new D1Querier(mockDb, new SqliteDialect());
  });

  it('should execute findMany via all()', async () => {
    mockStmt.all.mockResolvedValue({
      results: [{ id: 1 }],
      success: true,
      meta: {},
    } satisfies D1Result<any>);

    const res = await querier.internalAll('SELECT *', [1]);

    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT *');
    expect(mockStmt.bind).toHaveBeenCalledWith(1);
    expect(mockStmt.all).toHaveBeenCalled();
    expect(res).toEqual([{ id: 1 }]);
  });

  it('should execute INSERT and extract IDs from a RETURNING clause', async () => {
    // SQLite's dialect appends RETURNING, so `run()` reports the exact row(s) via `results`.
    mockStmt.run.mockResolvedValue({
      results: [{ id: 48 }, { id: 49 }, { id: 50 }],
      success: true,
      meta: {},
    } satisfies D1Result<any>);

    const res = await querier.internalRun('INSERT INTO ... RETURNING `id` `id`');

    expect(res).toEqual({
      changes: 3,
      ids: [48, 49, 50],
      firstId: 48,
    });
  });

  it('should fall back to meta.changes for a plain statement with no RETURNING rows', async () => {
    mockStmt.run.mockResolvedValue({
      results: [],
      success: true,
      meta: { changes: 5 },
    } satisfies D1Result<any>);

    const res = await querier.internalRun('UPDATE ...');

    expect(res).toEqual({
      changes: 5,
      ids: [],
      firstId: undefined,
    });
  });

  it('should execute internalAll without values', async () => {
    mockStmt.all.mockResolvedValue({
      results: [{ id: 1 }],
      success: true,
      meta: {},
    });

    await querier.internalAll('SELECT *');

    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT *');
    expect(mockStmt.bind).not.toHaveBeenCalled();
    expect(mockStmt.all).toHaveBeenCalled();
  });

  it('should bind the values of a write statement', async () => {
    mockStmt.run.mockResolvedValue({
      results: [{ id: 7 }],
      success: true,
      meta: { last_row_id: 7 },
    } satisfies D1Result<any>);

    const res = await querier.internalRun('INSERT INTO `User` (`name`) VALUES (?) RETURNING `id` `id`', ['maz']);

    expect(mockStmt.bind).toHaveBeenCalledWith('maz');
    expect(res).toEqual({ changes: 1, ids: [7], firstId: 7 });
  });

  /** A statement matching nothing reports no rows and no `changes`, which is zero rows affected. */
  it('should report no changes when the driver reports neither rows nor a change count', async () => {
    mockStmt.run.mockResolvedValue({ results: [], success: true, meta: {} } satisfies D1Result<any>);

    const res = await querier.internalRun('DELETE FROM `User` WHERE `id` = 404');

    expect(res).toEqual({ changes: 0, ids: [], firstId: undefined });
  });

  it('should release without touching the D1 binding', async () => {
    await expect(querier.release()).resolves.toBeUndefined();
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it('should roll back an open transaction on release', async () => {
    mockStmt.run.mockResolvedValue({ results: [], success: true, meta: {} });
    await querier.beginTransaction();

    await expect(querier.release()).resolves.toBeUndefined();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it('should execute internalRun without values', async () => {
    mockStmt.run.mockResolvedValue({
      results: [],
      success: true,
      meta: { changes: 1 },
    } satisfies D1Result<any>);

    await querier.internalRun('UPDATE ...');

    expect(mockDb.prepare).toHaveBeenCalledWith('UPDATE ...');
    expect(mockStmt.bind).not.toHaveBeenCalled();
    expect(mockStmt.run).toHaveBeenCalled();
  });
});
