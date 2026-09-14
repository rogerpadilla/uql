import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteDialect } from './sqliteDialect.js';
import { SqliteQuerier } from './sqliteQuerier.js';

async function* toAsync<T>(rows: T[]) {
  yield* rows;
}

function buildStmt(reader: boolean) {
  return { reader, all: vi.fn(), run: vi.fn(), iterate: vi.fn() };
}

type Stmt = ReturnType<typeof buildStmt>;

/**
 * `SqliteQuerier` serves a synchronous driver (`better-sqlite3`, `bun:sqlite`, `node:sqlite`) and an
 * asynchronous one (the embedded Turso engine) from one implementation, so each case below runs
 * against both: `wrap` decides whether the driver answers with a value or a promise.
 */
const drivers = [
  {
    name: 'synchronous driver',
    wrap: <T>(value: T): T | Promise<T> => value,
    iterable: <T>(rows: T[]): Iterable<T> | AsyncIterable<T> => rows,
    buildDb: (stmt: Stmt) => ({ prepare: vi.fn().mockReturnValue(stmt), close: vi.fn() }),
  },
  {
    name: 'asynchronous driver',
    wrap: <T>(value: T): T | Promise<T> => Promise.resolve(value),
    iterable: <T>(rows: T[]): Iterable<T> | AsyncIterable<T> => toAsync(rows),
    buildDb: (stmt: Stmt) => ({ prepare: vi.fn().mockResolvedValue(stmt), close: vi.fn() }),
  },
] as const;

describe.each(drivers)('SqliteQuerier on a $name', (driver) => {
  let stmt: Stmt;
  let db: ReturnType<typeof driver.buildDb>;
  let querier: SqliteQuerier;

  const use = (reader: boolean) => {
    stmt = buildStmt(reader);
    stmt.all.mockReturnValue(driver.wrap([]));
    stmt.run.mockReturnValue(driver.wrap({ changes: 0 }));
    db = driver.buildDb(stmt);
    querier = new SqliteQuerier(db, new SqliteDialect());
  };

  beforeEach(() => {
    use(true);
  });

  it('should bind nothing when no values are given', async () => {
    await querier.all('SELECT 1');
    expect(db.prepare).toHaveBeenCalledWith('SELECT 1');
    expect(stmt.all).toHaveBeenCalledWith();
  });

  it('should spread bound values', async () => {
    stmt.all.mockReturnValue(driver.wrap([{ id: 1 }]));

    const res = await querier.all('SELECT * FROM t WHERE id = ?', [1]);

    expect(stmt.all).toHaveBeenCalledWith(1);
    expect(res).toEqual([{ id: 1 }]);
  });

  it('should read back rows for a RETURNING statement rather than running it', async () => {
    // `run()` discards returned rows, so `reader` statements must go through `all()`.
    stmt.all.mockReturnValue(driver.wrap([{ id: 100 }]));

    const res = await querier.run('INSERT INTO t ... RETURNING `id` `id`', ['x']);

    expect(stmt.all).toHaveBeenCalledWith('x');
    expect(stmt.run).not.toHaveBeenCalled();
    expect(res).toEqual({ changes: 1, ids: [100], firstId: 100 });
  });

  it('should run a non-returning statement and report changes', async () => {
    use(false);
    stmt.run.mockReturnValue(driver.wrap({ changes: 3 }));

    const res = await querier.run('UPDATE t SET a = ?', [1]);

    expect(stmt.run).toHaveBeenCalledWith(1);
    expect(stmt.all).not.toHaveBeenCalled();
    expect(res).toEqual({ changes: 3, ids: [], firstId: undefined, created: undefined });
  });

  /** A statement that reads nothing has no rows to give, so asking for them runs it rather than failing. */
  it('should run a statement that reads nothing when asked for its rows', async () => {
    use(false);

    const rows = await querier.all('PRAGMA foreign_keys = ON');

    expect(stmt.run).toHaveBeenCalledWith();
    expect(stmt.all).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('should stream rows', async () => {
    stmt.iterate.mockReturnValue(driver.iterable([{ id: 1 }, { id: 2 }]));

    const rows = [];
    for await (const row of querier.internalStream('SELECT * FROM t')) {
      rows.push(row);
    }

    expect(stmt.iterate).toHaveBeenCalledWith();
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should decode an integer read as a bigint, exact past 2^53', async () => {
    stmt.all.mockReturnValue(driver.wrap([{ id: 1n, big: 9007199254740993n }]));

    const rows = await querier.all('SELECT id, big FROM t');

    expect(rows).toEqual([{ id: 1, big: '9007199254740993' }]);
  });

  it('should decode the ids a RETURNING statement reads as bigints', async () => {
    stmt.all.mockReturnValue(driver.wrap([{ id: 100n }]));

    const res = await querier.run('INSERT INTO t ... RETURNING `id` `id`', ['x']);

    expect(res).toEqual({ changes: 1, ids: [100], firstId: 100 });
  });

  it('should decode streamed rows read as bigints', async () => {
    stmt.iterate.mockReturnValue(driver.iterable([{ id: 1n }]));

    const rows = [];
    for await (const row of querier.internalStream('SELECT * FROM t')) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1 }]);
  });

  it('should roll back an open transaction on release', async () => {
    use(false);
    await querier.beginTransaction();

    await expect(querier.release()).resolves.toBeUndefined();
    expect(querier.hasOpenTransaction).toBe(false);
  });

  it('should release cleanly with no open transaction', async () => {
    await expect(querier.release()).resolves.toBeUndefined();
  });
});
