import { describe, expect, it, vi } from 'vitest';
import { TursoDialect } from './tursoDialect.js';
import { type TursoCursorEntry, type TursoSession, TursoSessionQuerier } from './tursoSessionQuerier.js';

/** A native session answering one result: each row an array of its values, named by `columns`. */
function buildSession(result: { columns: string[]; rows: unknown[][]; rowsAffected: number }) {
  return {
    execute: vi.fn().mockResolvedValue(result),
    executeRaw: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } satisfies TursoSession;
}

/** A statement's cursor, entry by entry, as the server streams it. */
async function* cursor(entries: TursoCursorEntry[]) {
  yield* entries;
}

describe('TursoSessionQuerier', () => {
  it('should bind the values as one array, reading integers as bigints', async () => {
    const session = buildSession({ columns: ['id'], rows: [[1n]], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await querier.all('SELECT `id` FROM `t` WHERE `id` = ?', [1]);

    expect(session.execute).toHaveBeenCalledWith('SELECT `id` FROM `t` WHERE `id` = ?', [1], true);
  });

  it('should name each value by its column, decoding a bigint exactly past 2^53', async () => {
    const session = buildSession({ columns: ['id', 'big'], rows: [[1n, 9007199254740993n]], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const rows = await querier.all('SELECT `id`, `big` FROM `t`');

    expect(rows).toEqual([{ id: 1, big: '9007199254740993' }]);
  });

  it('should count a RETURNING statement by its rows', async () => {
    const session = buildSession({ columns: ['id'], rows: [[7n]], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const res = await querier.run('INSERT INTO `t` DEFAULT VALUES RETURNING `id` `id`');

    expect(res).toEqual({ changes: 1, ids: [7], firstId: 7 });
  });

  it('should count any other statement by the rows the server says it affected', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 3 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    const res = await querier.run('UPDATE `t` SET `a` = 1');

    expect(res).toEqual({ changes: 3, ids: [], firstId: undefined });
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

  /** Each request carries the previous response's baton, so the three statements share one server stream. */
  it('should run a transaction as statements on its own session', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await querier.beginTransaction();
    await querier.run('UPDATE `t` SET `a` = 1');
    await querier.commitTransaction();

    expect(session.execute.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN TRANSACTION',
      'UPDATE `t` SET `a` = 1',
      'COMMIT',
    ]);
  });

  it('should close its session on release', async () => {
    const session = buildSession({ columns: [], rows: [], rowsAffected: 0 });
    const querier = new TursoSessionQuerier(session, new TursoDialect());

    await querier.release();

    expect(session.close).toHaveBeenCalled();
  });
});
