import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { type D1Database, type D1ExecResult, D1Querier, type D1Result } from './d1Querier.js';

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
    querier = new D1Querier(mockDb as unknown as D1Database);
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

  it('should execute INSERT and extract IDs from meta', async () => {
    mockStmt.run.mockResolvedValue({
      count: 0,
      duration: 1,
      meta: {
        last_row_id: 50,
        changes: 3,
      },
    } satisfies D1ExecResult);

    const res = await querier.internalRun('INSERT INTO ...');

    expect(res).toEqual({
      changes: 3,
      // firstID = 50 - (3 - 1) = 48
      // [48, 49, 50]
      ids: [48, 49, 50],
      firstId: 48,
    });
  });

  it('should handle missing meta safely', async () => {
    mockStmt.run.mockResolvedValue({
      count: 5,
      duration: 1,
    } satisfies D1ExecResult);

    const res = await querier.internalRun('UPDATE ...');

    expect(res).toEqual({
      changes: 5,
      ids: [],
      firstId: undefined,
    });
  });
});
