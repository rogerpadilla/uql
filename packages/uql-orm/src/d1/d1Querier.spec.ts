import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { SqliteDialect } from '../sqlite/index.js';
import { type D1Database, D1Querier, type D1Result } from './d1Querier.js';

describe('D1Querier', () => {
  let mockDb: {
    prepare: Mock<any>;
  };
  let mockStmt: {
    bind: Mock<any>;
    all: Mock<any>;
    run: Mock<any>;
  };
  let querier: D1Querier;

  beforeEach(() => {
    mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(),
      run: vi.fn(),
    };
    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStmt),
    };
    querier = new D1Querier(mockDb as unknown as D1Database, new SqliteDialect());
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
