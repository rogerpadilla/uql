import { describe, expect, it, vi } from 'vitest';
import { Coupon, fiveCoupons } from '../test/index.js';
import { sql } from '../util/sql.js';
import { TursoDialect } from './tursoDialect.js';
import { type TursoCursorEntry, type TursoSession, TursoSessionQuerier } from './tursoSessionQuerier.js';

/** A native session answering one result: each row an array of its values, named by `columns`. */
function buildSession(result: { columns: string[]; rows: unknown[][]; rowsAffected: number }) {
  return {
    execute: vi.fn().mockResolvedValue(result),
    executeRaw: vi.fn(),
    batch: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } satisfies TursoSession;
}

/** Three coupons a statement, so five split in two. */
class ThreeCouponDialect extends TursoDialect {
  override readonly maxBindValues = 6;
}

/** What a split insert of {@link fiveCoupons} answers: three ids, then two, each row an array of its values. */
const insertedIds = [
  { columns: ['id'], rows: [[1n], [2n], [3n]], rowsAffected: 0 },
  { columns: ['id'], rows: [[4n], [5n]], rowsAffected: 0 },
];

/** A statement's cursor, entry by entry, as the server streams it. */
async function* cursor(entries: TursoCursorEntry[]) {
  yield* entries;
}

describe('TursoSessionQuerier', () => {
  it('should bind the values as one array, reading integers as bigints', async () => {
    const session = buildSession({ columns: ['id'], rows: [[1n]], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await querier.all`SELECT \`id\` FROM \`t\` WHERE \`id\` = ${1}`;

    expect(session.execute).toHaveBeenCalledWith('SELECT `id` FROM `t` WHERE `id` = ?', [1], true);
  });

  it('should name each value by its column, decoding a bigint exactly past 2^53', async () => {
    const session = buildSession({ columns: ['id', 'big'], rows: [[1n, 9007199254740993n]], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const rows = await querier.all(sql.text('SELECT `id`, `big` FROM `t`'));

    expect(rows).toEqual([{ id: 1, big: '9007199254740993' }]);
  });

  it('should count a RETURNING statement by its rows', async () => {
    const session = buildSession({ columns: ['id'], rows: [[7n]], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const res = await querier.run(sql.text('INSERT INTO `t` DEFAULT VALUES RETURNING `id` `id`'));

    expect(res).toEqual({ changes: 1, ids: [7] });
  });

  it('should count any other statement by the rows the server says it affected', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 3 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const res = await querier.run(sql.text('UPDATE `t` SET `a` = 1'));

    expect(res).toEqual({ changes: 3, ids: [] });
  });

  /** The rows arrive as the server steps the statement, never held in memory together. */
  it("should stream the rows off the statement's cursor, each named by its column and decoded exactly", async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    session.executeRaw.mockResolvedValue({
      entries: cursor([
        { type: 'step_begin', cols: [{ name: 'id' }, { name: 'big' }] },
        {
          type: 'row',
          row: [
            { type: 'integer', value: '1' },
            { type: 'integer', value: '9007199254740993' },
          ],
        },
        { type: 'row', row: [{ type: 'integer', value: '2' }, { type: 'null' }] },
        { type: 'step_end' },
      ]),
    });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const rows = [];
    for await (const row of querier.internalStream('SELECT `id`, `big` FROM `t` WHERE `id` > ?', [0])) {
      rows.push(row);
    }

    expect(session.executeRaw).toHaveBeenCalledWith('SELECT `id`, `big` FROM `t` WHERE `id` > ?', [0]);
    expect(rows).toEqual([
      { id: 1, big: '9007199254740993' },
      { id: 2, big: null },
    ]);
  });

  it('should throw the error a cursor streams', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    session.executeRaw.mockResolvedValue({
      entries: cursor([{ type: 'step_error', error: { message: 'no such table: t', code: 'SQLITE_ERROR' } }]),
    });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await expect(querier.internalStream('SELECT * FROM `t`').next()).rejects.toThrow('no such table: t');
  });

  /** The driver types an entry's error as optional, so one arriving without it still fails the stream. */
  it('should throw for an error entry that carries no detail', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    session.executeRaw.mockResolvedValue({ entries: cursor([{ type: 'error' }]) });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await expect(querier.internalStream('SELECT * FROM `t`').next()).rejects.toThrow('SQL execution failed');
  });

  /** Each request carries the previous response's baton, so the three statements share one server stream. */
  it('should run a transaction as statements on its own session', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await querier.transaction(async () => {
      await querier.run(sql.text('UPDATE `t` SET `a` = 1'));
    });

    expect(session.execute.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN IMMEDIATE',
      'UPDATE `t` SET `a` = 1',
      'COMMIT',
    ]);
  });

  /** One request carrying its own `BEGIN IMMEDIATE`, `COMMIT` and `ROLLBACK`, so it lands whole or not at all. */
  it('should send a split insert as one atomic batch of its session', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    session.batch.mockResolvedValue(insertedIds);
    const querier = new TursoSessionQuerier(session, new ThreeCouponDialect());

    const ids = await querier.insertMany(Coupon, fiveCoupons);

    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(session.batch).toHaveBeenCalledTimes(1);
    expect(session.batch.mock.calls[0]?.slice(1)).toEqual(['immediate', undefined, true, true]);
    expect(session.execute).not.toHaveBeenCalled();
  });

  it('should send a split insert inside a transaction as a batch with no mode, which joins it', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    session.batch.mockResolvedValue(insertedIds);
    const querier = new TursoSessionQuerier(session, new ThreeCouponDialect());

    await querier.transaction(() => querier.insertMany(Coupon, fiveCoupons));

    expect(session.batch.mock.calls[0]?.[1]).toBeUndefined();
    expect(session.execute.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
  });

  it('should tag a failed split insert with the statement its session names', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    session.batch.mockRejectedValue(Object.assign(new Error('UNIQUE constraint failed'), { batchIndex: 1 }));
    const querier = new TursoSessionQuerier(session, new ThreeCouponDialect());

    await expect(querier.insertMany(Coupon, fiveCoupons)).rejects.toMatchObject({
      query: expect.stringMatching(/^INSERT/),
    });
    expect(session.execute).not.toHaveBeenCalled();
  });

  it('should close its session on release', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await querier.release();

    expect(session.close).toHaveBeenCalled();
  });
});
