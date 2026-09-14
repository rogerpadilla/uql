import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteDialect } from '../sqlite/index.js';
import type { RawRow } from '../type/index.js';
import { D1Querier, type D1Result } from './d1Querier.js';
import { D1SqliteDialect } from './d1SqliteDialect.js';

/** D1 documents `run()` as an alias of `all()`, so the querier calls `all()` for every statement. */
function buildStmt() {
  return { bind: vi.fn().mockReturnThis(), all: vi.fn() };
}

function buildDb(stmt: ReturnType<typeof buildStmt>) {
  return { prepare: vi.fn().mockReturnValue(stmt) };
}

/** What D1 answers: the rows a statement read, and its metadata. */
function result(results: RawRow[], meta: D1Result['meta'] = {}): D1Result<RawRow> {
  return { results, success: true, meta };
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

  /** D1's API refuses a `bigint` bind, and a number would round it; the text lands as the same INTEGER. */
  it('should bind a bigint as its exact text', async () => {
    const d1 = new D1Querier(mockDb, new D1SqliteDialect());
    mockStmt.all.mockResolvedValue(result([]));

    await d1.all('SELECT ?', [9007199254740993n]);

    expect(mockStmt.bind).toHaveBeenCalledWith('9007199254740993');
  });

  it('should read rows, binding the values', async () => {
    mockStmt.all.mockResolvedValue(result([{ id: 1 }]));

    const res = await querier.internalAll('SELECT *', [1]);

    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT *');
    expect(mockStmt.bind).toHaveBeenCalledWith(1);
    expect(res).toEqual([{ id: 1 }]);
  });

  it('should bind nothing when no values are given', async () => {
    mockStmt.all.mockResolvedValue(result([{ id: 1 }]));

    await querier.internalAll('SELECT *');

    expect(mockStmt.bind).not.toHaveBeenCalled();
    expect(mockStmt.all).toHaveBeenCalled();
  });

  it('should take the ids of an INSERT from its RETURNING rows', async () => {
    mockStmt.all.mockResolvedValue(result([{ id: 48 }, { id: 49 }, { id: 50 }]));

    const res = await querier.internalRun('INSERT INTO ... RETURNING `id` `id`', ['maz']);

    expect(mockStmt.bind).toHaveBeenCalledWith('maz');
    expect(res).toEqual({ changes: 3, ids: [48, 49, 50], firstId: 48 });
  });

  it('should count a statement with no RETURNING rows by meta.changes', async () => {
    mockStmt.all.mockResolvedValue(result([], { changes: 5 }));

    const res = await querier.internalRun('UPDATE ...');

    expect(mockStmt.bind).not.toHaveBeenCalled();
    expect(res).toEqual({ changes: 5, ids: [], firstId: undefined });
  });

  /** A statement matching nothing reports no rows and no `changes`, which is zero rows affected. */
  it('should report no changes when the driver reports neither rows nor a change count', async () => {
    mockStmt.all.mockResolvedValue(result([]));

    const res = await querier.internalRun('DELETE FROM `User` WHERE `id` = 404');

    expect(res).toEqual({ changes: 0, ids: [], firstId: undefined });
  });

  it('should release without touching the D1 binding', async () => {
    await expect(querier.release()).resolves.toBeUndefined();
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  /** D1 answers `BEGIN` with `D1_ERROR: not authorized`, so the transaction is refused before it is sent. */
  it('should refuse a transaction, which D1 does not have', async () => {
    await expect(querier.beginTransaction()).rejects.toThrow('Cloudflare D1 has no transactions');

    expect(mockDb.prepare).not.toHaveBeenCalled();
    expect(querier.hasOpenTransaction).toBe(false);
  });
});
