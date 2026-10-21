import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Coupon, fiveCoupons } from '../test/index.js';
import { HranaQuerier } from './hranaQuerier.js';
import { SqliteDialect } from './sqliteDialect.js';

function buildTx() {
  return { execute: vi.fn(), batch: vi.fn(), commit: vi.fn(), rollback: vi.fn(), close: vi.fn() };
}

function buildClient(tx: ReturnType<typeof buildTx>) {
  return { execute: vi.fn(), batch: vi.fn(), transaction: vi.fn().mockResolvedValue(tx), close: vi.fn() };
}

/** Three coupons a statement, so five split in two. */
class ThreeCouponDialect extends SqliteDialect {
  override readonly maxBindValues = 6;
}

/** What a split insert of {@link fiveCoupons} answers: three ids, then two. */
const insertedIds = [
  { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], rowsAffected: 0 },
  { rows: [{ id: 4 }, { id: 5 }], rowsAffected: 0 },
];

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

    const res = await querier.all`SELECT 1`;

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

    const res = await querier.run`INSERT INTO \`Coupon\` DEFAULT VALUES RETURNING \`id\` \`id\``;

    expect(res).toEqual({
      changes: 1,
      ids: [100],
    });
  });

  it('should decode integers the client reads as bigints, exact past 2^53', async () => {
    mockClient.execute.mockResolvedValue({ rows: [{ id: 1n, big: 9007199254740993n }], rowsAffected: 0 });

    const res = await querier.all`SELECT id, big FROM t`;

    expect(res).toEqual([{ id: 1, big: '9007199254740993' }]);
  });

  it('should decode the ids a RETURNING statement reads as bigints', async () => {
    mockClient.execute.mockResolvedValue({ rows: [{ id: 100n }], rowsAffected: 0 });

    const res = await querier.run`INSERT INTO \`Coupon\` DEFAULT VALUES RETURNING \`id\` \`id\``;

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
      await querier.all`SELECT 1`;
    });

    expect(mockClient.transaction).toHaveBeenCalledWith('write');
    expect(mockTx.execute).toHaveBeenCalled();
    expect(mockClient.execute).not.toHaveBeenCalled();
    expect(mockTx.commit).toHaveBeenCalled();
  });

  it('should send a split insert as one batch of the client, all or none', async () => {
    mockClient.batch.mockResolvedValue(insertedIds);
    const split = new HranaQuerier(mockClient, new ThreeCouponDialect());

    const ids = await split.insertMany(Coupon, fiveCoupons);

    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(mockClient.batch).toHaveBeenCalledTimes(1);
    expect(mockClient.batch.mock.calls[0]?.[1]).toBe('write');
    expect(mockClient.execute).not.toHaveBeenCalled();
  });

  it('should send a split insert inside a transaction as the batch of its session, which joins it', async () => {
    mockTx.batch.mockResolvedValue(insertedIds);
    const split = new HranaQuerier(mockClient, new ThreeCouponDialect());

    await split.transaction(() => split.insertMany(Coupon, fiveCoupons));

    expect(mockTx.batch).toHaveBeenCalledTimes(1);
    expect(mockClient.batch).not.toHaveBeenCalled();
    expect(mockTx.commit).toHaveBeenCalled();
  });

  it('should tag a failed split insert with the statement the client names, or the list where it names none', async () => {
    mockClient.batch.mockRejectedValueOnce(Object.assign(new Error('UNIQUE constraint failed'), { statementIndex: 1 }));
    mockClient.batch.mockRejectedValueOnce(new Error('connection lost'));
    const split = new HranaQuerier(mockClient, new ThreeCouponDialect());

    await expect(split.insertMany(Coupon, fiveCoupons)).rejects.toMatchObject({
      query: expect.stringMatching(/^INSERT/),
    });
    await expect(split.insertMany(Coupon, fiveCoupons)).rejects.toMatchObject({
      query: expect.stringContaining('; INSERT'),
    });
  });

  /** libSQL's own read mode, which refuses a write and takes no write lock. */
  it('should open a read-only transaction in the read mode of the client', async () => {
    await querier.transaction(async () => {}, { readOnly: true });

    expect(mockClient.transaction).toHaveBeenCalledWith('read');
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
