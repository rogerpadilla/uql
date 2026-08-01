import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TursoLocalQuerier } from '../turso/local.js';
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
 * `PreparedSqliteQuerier` serves both a synchronous driver (`better-sqlite3`, `bun:sqlite`) and an
 * asynchronous one (the embedded Turso engine) from one implementation, so each case below runs
 * against both: `wrap` decides whether the driver answers with a value or a promise.
 */
const drivers = [
  {
    name: 'SqliteQuerier (synchronous driver)',
    wrap: <T>(value: T): T | Promise<T> => value,
    iterable: <T>(rows: T[]): Iterable<T> | AsyncIterable<T> => rows,
    build(stmt: Stmt) {
      const db = { prepare: vi.fn().mockReturnValue(stmt), loadExtension: vi.fn(), close: vi.fn() };
      return { db, querier: new SqliteQuerier(db, new SqliteDialect()) };
    },
  },
  {
    name: 'TursoLocalQuerier (asynchronous driver)',
    wrap: <T>(value: T): T | Promise<T> => Promise.resolve(value),
    iterable: <T>(rows: T[]): Iterable<T> | AsyncIterable<T> => toAsync(rows),
    build(stmt: Stmt) {
      const db = { prepare: vi.fn().mockResolvedValue(stmt), pragma: vi.fn(), close: vi.fn() };
      return { db, querier: new TursoLocalQuerier(db, new SqliteDialect()) };
    },
  },
] as const;

describe.each(drivers)('$name', (driver) => {
  let stmt: Stmt;
  let db: { prepare: ReturnType<typeof vi.fn> };
  let querier: SqliteQuerier | TursoLocalQuerier;

  const use = (reader: boolean) => {
    stmt = buildStmt(reader);
    stmt.all.mockReturnValue(driver.wrap([]));
    stmt.run.mockReturnValue(driver.wrap({ changes: 0, lastInsertRowid: 0 }));
    ({ db, querier } = driver.build(stmt));
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
    stmt.run.mockReturnValue(driver.wrap({ changes: 3, lastInsertRowid: 42 }));

    const res = await querier.run('UPDATE t SET a = ?', [1]);

    expect(stmt.run).toHaveBeenCalledWith(1);
    expect(stmt.all).not.toHaveBeenCalled();
    // SQLite reports ids via RETURNING, so the header `lastInsertRowid` is deliberately ignored.
    expect(res).toEqual({ changes: 3, ids: [], firstId: undefined, created: undefined });
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

  it('should reject release while a transaction is open', async () => {
    use(false);
    await querier.beginTransaction();

    await expect(querier.release()).rejects.toThrow('pending transaction');
  });

  it('should release cleanly with no open transaction', async () => {
    await expect(querier.release()).resolves.toBeUndefined();
  });
});
