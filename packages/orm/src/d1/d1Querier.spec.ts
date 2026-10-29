import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withContext } from '../context/context.js';
import type { SqliteBindValue } from '../sqlite/bindValues.js';
import { Coupon, TenantNote } from '../test/index.js';
import type { RawRow } from '../type/index.js';

import { D1Querier, type D1PreparedStatement, type D1Queryable, type D1Result } from './d1Querier.js';
import { D1SqliteDialect } from './d1SqliteDialect.js';

/** D1 documents `run()` as an alias of `all()`, so the querier calls `all()` for every statement. */
function buildStmt() {
  return { bind: vi.fn().mockReturnThis(), all: vi.fn() };
}

function buildDb(stmt: ReturnType<typeof buildStmt>) {
  return { prepare: vi.fn().mockReturnValue(stmt), batch: vi.fn() };
}

/** D1 over `node:sqlite`: `all()` answers every statement, as D1 documents, and `batch()` runs a list in one transaction. */
function d1Over(db: DatabaseSync): D1Queryable {
  const runs = new WeakMap<D1PreparedStatement, () => D1Result>();
  const prepare = (query: string, values: SqliteBindValue[] = []): D1PreparedStatement => {
    const run = (): D1Result => {
      const stmt = db.prepare(query);
      return stmt.columns().length
        ? { results: stmt.all(...values), meta: {} }
        : { results: [], meta: { changes: Number(stmt.run(...values).changes) } };
    };
    const statement: D1PreparedStatement = { bind: (...bound) => prepare(query, bound), all: async () => run() };
    runs.set(statement, run);
    return statement;
  };
  const runOf = (statement: D1PreparedStatement) => {
    const run = runs.get(statement);
    if (!run) {
      throw new TypeError('a statement this binding did not prepare');
    }
    return run();
  };
  return {
    prepare: (query) => prepare(query),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const results = statements.map(runOf);
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

/** What D1 answers: the rows a statement read, and its metadata. */
function result(results: RawRow[], meta: D1Result['meta'] = {}): D1Result {
  return { results, meta };
}

describe('D1Querier', () => {
  let mockDb: ReturnType<typeof buildDb>;
  let mockStmt: ReturnType<typeof buildStmt>;
  let querier: D1Querier;

  beforeEach(() => {
    mockStmt = buildStmt();
    mockDb = buildDb(mockStmt);
    querier = new D1Querier(mockDb, new D1SqliteDialect());
  });

  /** D1's API refuses a `bigint` bind, and a number would round it; the text lands as the same INTEGER. */
  it('should bind a bigint as its exact text', async () => {
    const d1 = new D1Querier(mockDb, new D1SqliteDialect());
    mockStmt.all.mockResolvedValue(result([]));

    await d1.all`SELECT ${9007199254740993n}`;

    expect(mockStmt.bind).toHaveBeenCalledWith('9007199254740993');
  });

  /** A write split to fit 100 binds goes as one `batch()`, which D1 runs as one transaction, the one it has. */
  it('should write a split insert as one batch', async () => {
    const d1 = new D1Querier(mockDb, new D1SqliteDialect());
    mockDb.batch.mockImplementation(async (statements: unknown[]) => statements.map(() => result([], { changes: 1 })));

    await d1.insertMany(
      Coupon,
      Array.from({ length: 60 }, (_, index) => ({ code: `c${index}`, label: 'x' })),
    );

    expect(mockDb.prepare.mock.calls.map(([sql]) => String(sql).split(' ')[0])).toEqual(['INSERT', 'INSERT']);
    expect(mockDb.batch.mock.calls).toEqual([[[mockStmt, mockStmt]]]);
    expect(mockStmt.all).not.toHaveBeenCalled();
  });

  /** Its statements report every row's id in order, so none is read back. */
  it('should write a split upsert as one batch', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT UNIQUE, `label` TEXT)');
    const binding = d1Over(db);
    const prepare = vi.spyOn(binding, 'prepare');
    const batch = vi.spyOn(binding, 'batch');
    const d1 = new D1Querier(binding, new D1SqliteDialect());

    const ids = await d1.upsertMany(
      Coupon,
      { $conflict: { code: true } },
      Array.from({ length: 60 }, (_, index) => ({ code: `c${index}`, label: 'x' })),
    );

    expect(prepare.mock.calls.map(([sql]) => sql.split(' ')[0])).toEqual(['INSERT', 'INSERT']);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(ids).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
  });

  it('should write nothing of a split insert whose last statement fails', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE `Coupon` (`id` INTEGER PRIMARY KEY, `code` TEXT UNIQUE, `label` TEXT)');
    const d1 = new D1Querier(d1Over(db), new D1SqliteDialect());
    const rows = Array.from({ length: 60 }, (_, index) => ({ code: `c${index % 59}`, label: 'x' }));

    await expect(d1.insertMany(Coupon, rows)).rejects.toThrow('UNIQUE constraint failed');

    expect(db.prepare('SELECT COUNT(*) AS `n` FROM `Coupon`').get()).toEqual({ n: 0 });
  });

  /** A guarded upsert reads its rows back first, then writes them: two statements, held by no transaction. */
  it('should upsert guarded rows with no BEGIN', async () => {
    const d1 = new D1Querier(mockDb, new D1SqliteDialect());
    mockStmt.all.mockResolvedValue(result([], { changes: 1 }));

    await withContext({ tenantId: 't' }, () =>
      d1.upsertMany(TenantNote, { $conflict: { id: true } }, [
        { id: 'a', title: 'a' },
        { id: 'b', title: 'b' },
      ]),
    );

    expect(mockDb.prepare.mock.calls.map(([sql]) => String(sql).split(' ')[0])).toEqual(['SELECT', 'INSERT']);
  });

  it('should read rows, binding the values', async () => {
    mockStmt.all.mockResolvedValue(result([{ id: 1 }]));

    const res = await querier.all`SELECT * FROM \`User\` WHERE \`id\` = ${1}`;

    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM `User` WHERE `id` = ?');
    expect(mockStmt.bind).toHaveBeenCalledWith(1);
    expect(res).toEqual([{ id: 1 }]);
  });

  it('should bind nothing when no values are given', async () => {
    mockStmt.all.mockResolvedValue(result([{ id: 1 }]));

    await querier.all`SELECT * FROM \`User\``;

    expect(mockStmt.bind).not.toHaveBeenCalled();
    expect(mockStmt.all).toHaveBeenCalled();
  });

  it('should take the ids of an INSERT from its RETURNING rows', async () => {
    mockStmt.all.mockResolvedValue(result([{ id: 48 }, { id: 49 }, { id: 50 }]));

    const res = await querier.run`INSERT INTO \`User\` (\`name\`) VALUES (${'maz'}) RETURNING \`id\` \`id\``;

    expect(mockStmt.bind).toHaveBeenCalledWith('maz');
    expect(res).toEqual({ changes: 3, ids: [48, 49, 50] });
  });

  it('should count a statement with no RETURNING rows by meta.changes', async () => {
    mockStmt.all.mockResolvedValue(result([], { changes: 5 }));

    const res = await querier.run`UPDATE \`User\` SET \`name\` = NULL`;

    expect(mockStmt.bind).not.toHaveBeenCalled();
    expect(res).toEqual({ changes: 5, ids: [] });
  });

  /** A statement matching nothing reports no rows and no `changes`, which is zero rows affected. */
  it('should report no changes when the driver reports neither rows nor a change count', async () => {
    mockStmt.all.mockResolvedValue(result([]));

    const res = await querier.run`DELETE FROM \`User\` WHERE \`id\` = 404`;

    expect(res).toEqual({ changes: 0, ids: [] });
  });

  it('should release without touching the D1 binding', async () => {
    await expect(querier.release()).resolves.toBeUndefined();
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  /** D1 answers `BEGIN` with `D1_ERROR: not authorized`, so the transaction is refused before it is sent. */
  it('should refuse a transaction, which D1 does not have', async () => {
    const callback = vi.fn(async () => {});

    await expect(querier.transaction(callback)).rejects.toThrow(
      'Cloudflare D1 has no transactions: write the changes as one statement, or idempotently',
    );

    expect(callback).not.toHaveBeenCalled();
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });
});
