import { expect, it, vi } from 'vitest';
import { getContext, withContext } from '../context/context.js';
import { PostgresDialect } from '../dialect/index.js';
import { createMockQuerier, createMockQuerierPool, User } from '../test/index.js';
import type { Querier, QueryUpdateResult, SqlQuerier, Type, UqlContext } from '../type/index.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';
import { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/** Minimal stub: only the members `withQuerier`/`transaction` touch. */
function createStubQuerier() {
  return {
    transaction: vi.fn((callback: () => Promise<unknown>) => callback()),
    release: vi.fn(async () => {}),
  } as unknown as Querier;
}

/** Pool that hands out a fresh querier per acquisition and records how many it acquired. */
class CountingPool extends AbstractQuerierPool<Querier, PostgresDialect> {
  readonly acquired: Querier[] = [];
  constructor(private readonly make: () => Querier) {
    super(new PostgresDialect());
  }
  override getQuerier(): Promise<Querier> {
    const querier = this.make();
    this.acquired.push(querier);
    return Promise.resolve(querier);
  }
  override end(): Promise<void> {
    return Promise.resolve();
  }
}

it('withQuerier runs the callback under the given context and releases the querier', async () => {
  const querier = createStubQuerier();
  const pool = new CountingPool(() => querier);
  let seen: UqlContext | undefined;

  const result = await pool.withQuerier(
    async () => {
      seen = getContext();
      return 'done';
    },
    { context: { tenantId: 5 } },
  );

  expect(result).toBe('done');
  expect(seen).toEqual({ tenantId: 5 });
  expect(getContext()).toBeUndefined(); // scope ends with the unit of work
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('withQuerier without a context leaves the ambient context untouched', async () => {
  const pool = new CountingPool(createStubQuerier);
  let seen: UqlContext | undefined = { sentinel: true };
  await pool.withQuerier(async () => {
    seen = getContext();
  });
  expect(seen).toBeUndefined();
});

it('withQuerier releases the querier even when the callback throws under a context', async () => {
  const querier = createStubQuerier();
  const pool = new CountingPool(() => querier);
  await expect(
    pool.withQuerier(
      async () => {
        throw new Error('boom');
      },
      { context: { tenantId: 5 } },
    ),
  ).rejects.toThrow('boom');
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('transaction runs the callback under the given context', async () => {
  const querier = createStubQuerier();
  const pool = new CountingPool(() => querier);
  let seen: UqlContext | undefined;

  await pool.transaction(
    async () => {
      seen = getContext();
      return 1;
    },
    { context: { tenantId: 3 } },
  );

  expect(seen).toEqual({ tenantId: 3 });
  expect(querier.transaction).toHaveBeenCalledTimes(1);
  expect(getContext()).toBeUndefined();
});

class Item {
  id?: number;
}

/** Stub querier exposing the read methods the pool convenience layer delegates to. */
function createReadStubQuerier() {
  return {
    findOneById: vi.fn(async () => ({ id: 1 })),
    findOne: vi.fn(async () => ({ id: 1 })),
    findMany: vi.fn(async () => [{ id: 1 }]),
    findManyAndCount: vi.fn(async () => [[{ id: 1 }], 1]),
    count: vi.fn(async () => 7),
    aggregate: vi.fn(async () => [{ total: 3 }]),
    release: vi.fn(async () => {}),
  } as unknown as Querier;
}

it('findMany delegates to a per-call querier and releases it', async () => {
  const querier = createReadStubQuerier();
  const pool = new CountingPool(() => querier);
  const result = await pool.findMany(Item as Type<Item>, { $where: { id: 1 } });
  expect(result).toEqual([{ id: 1 }]);
  expect(querier.findMany).toHaveBeenCalledWith(Item, { $where: { id: 1 } }, undefined);
  expect(pool.acquired).toHaveLength(1);
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('concurrent pool reads each acquire their own connection (parallel, not serialized)', async () => {
  const pool = new CountingPool(createReadStubQuerier);
  const [rows, total] = await Promise.all([pool.findMany(Item as Type<Item>, {}), pool.count(Item as Type<Item>, {})]);
  expect(rows).toEqual([{ id: 1 }]);
  expect(total).toBe(7);
  // Two separate connections were acquired - the basis for genuine parallelism.
  expect(pool.acquired).toHaveLength(2);
  for (const querier of pool.acquired) {
    expect(querier.release).toHaveBeenCalledTimes(1);
  }
});

it('every read helper delegates to a fresh querier and releases it', async () => {
  const pool = new CountingPool(createReadStubQuerier);
  const entity = Item as Type<Item>;

  expect(await pool.findOneById(entity, 1)).toEqual({ id: 1 });
  expect(await pool.findOne(entity, {})).toEqual({ id: 1 });
  expect(await pool.findManyAndCount(entity, {})).toEqual([[{ id: 1 }], 1]);
  expect(await pool.aggregate(entity, { $group: {} })).toEqual([{ total: 3 }]);

  const [byId, one, andCount, agg] = pool.acquired;
  expect(byId.findOneById).toHaveBeenCalledWith(entity, 1, undefined, undefined);
  expect(one.findOne).toHaveBeenCalledWith(entity, {}, undefined);
  expect(andCount.findManyAndCount).toHaveBeenCalledWith(entity, {}, undefined);
  expect(agg.aggregate).toHaveBeenCalledWith(entity, { $group: {} }, undefined);
  // One fresh connection acquired and released per call.
  expect(pool.acquired).toHaveLength(4);
  for (const acquired of pool.acquired) {
    expect(acquired.release).toHaveBeenCalledTimes(1);
  }
});

/** Stub querier exposing the write methods the pool delegates to, plus a stream. */
function createWriteStubQuerier() {
  const querier = {
    insertOne: vi.fn(async () => 1),
    insertMany: vi.fn(async () => [1, 2]),
    updateOneById: vi.fn(async () => 1),
    updateMany: vi.fn(async () => 2),
    upsertOne: vi.fn(async (): Promise<QueryUpdateResult> => ({ changes: 1 })),
    upsertMany: vi.fn(async (): Promise<QueryUpdateResult> => ({ changes: 2 })),
    saveOne: vi.fn(async () => 1),
    saveMany: vi.fn(async () => [1, 2]),
    deleteOneById: vi.fn(async () => 1),
    deleteMany: vi.fn(async () => 2),
    restoreOneById: vi.fn(async () => 1),
    restoreMany: vi.fn(async () => 2),
    findManyStream: vi.fn(async function* () {
      yield { id: 1 };
      yield { id: 2 };
    }),
    release: vi.fn(async () => {}),
    [Symbol.asyncDispose]: vi.fn(async () => {}),
  };
  return querier as unknown as Querier;
}

it('every write delegates to a fresh querier and releases it', async () => {
  const pool = new CountingPool(createWriteStubQuerier);
  const entity = Item as Type<Item>;

  expect(await pool.insertOne(entity, { id: 1 })).toBe(1);
  expect(await pool.insertMany(entity, [{ id: 1 }])).toEqual([1, 2]);
  expect(await pool.updateOneById(entity, 1, { id: 2 })).toBe(1);
  expect(await pool.updateMany(entity, {}, { id: 2 })).toBe(2);
  expect(await pool.upsertOne(entity, { id: true }, { id: 1 })).toEqual({ changes: 1 });
  expect(await pool.upsertMany(entity, { id: true }, [{ id: 1 }])).toEqual({ changes: 2 });
  expect(await pool.saveOne(entity, { id: 1 })).toBe(1);
  expect(await pool.saveMany(entity, [{ id: 1 }])).toEqual([1, 2]);
  expect(await pool.deleteOneById(entity, 1)).toBe(1);
  expect(await pool.deleteMany(entity, {})).toBe(2);
  expect(await pool.restoreOneById(entity, 1)).toBe(1);
  expect(await pool.restoreMany(entity, {})).toBe(2);

  // A pool call is one unit of work, and two of them are not one.
  expect(pool.acquired).toHaveLength(12);
  for (const acquired of pool.acquired) {
    expect(acquired.release).toHaveBeenCalledTimes(1);
  }
});

it('a pool write releases the connection when the operation throws', async () => {
  const querier = createWriteStubQuerier();
  (querier.insertOne as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('constraint'));
  const pool = new CountingPool(() => querier);

  await expect(pool.insertOne(Item as Type<Item>, { id: 1 })).rejects.toThrow('constraint');
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('findManyStream holds one connection for the whole iteration and disposes it at the end', async () => {
  const querier = createWriteStubQuerier();
  const pool = new CountingPool(() => querier);
  const seen: unknown[] = [];

  for await (const row of pool.findManyStream(Item as Type<Item>, {})) {
    seen.push(row);
  }

  expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
  expect(pool.acquired).toHaveLength(1);
  expect(querier[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
});

it('findManyStream disposes the connection when the consumer stops early', async () => {
  const querier = createWriteStubQuerier();
  const pool = new CountingPool(() => querier);

  for await (const _row of pool.findManyStream(Item as Type<Item>, {})) {
    break;
  }

  expect(querier[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
});

it('pool reads run under the ambient context', async () => {
  const querier = createReadStubQuerier();
  const pool = new CountingPool(() => querier);
  let seen: UqlContext | undefined;
  (querier.count as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    seen = getContext();
    return 0;
  });
  await withContext({ tenantId: 9 }, () => pool.count(Item as Type<Item>, {}));
  expect(seen).toEqual({ tenantId: 9 });
});

/** Stub SQL querier exposing raw all/run. */
function createSqlStubQuerier() {
  return {
    all: vi.fn(async () => [{ n: 1 }]),
    run: vi.fn(async (): Promise<QueryUpdateResult> => ({ changes: 1 })),
    release: vi.fn(async () => {}),
  } as unknown as SqlQuerier;
}

class CountingSqlPool extends AbstractSqlQuerierPool<SqlQuerier, PostgresDialect> {
  readonly acquired: SqlQuerier[] = [];
  constructor(private readonly make: () => SqlQuerier) {
    super(new PostgresDialect());
  }
  override getQuerier(): Promise<SqlQuerier> {
    const querier = this.make();
    this.acquired.push(querier);
    return Promise.resolve(querier);
  }
  override end(): Promise<void> {
    return Promise.resolve();
  }
}

it('all/run delegate to a per-call querier and release it', async () => {
  const pool = new CountingSqlPool(createSqlStubQuerier);
  const rows = await pool.all('SELECT 1', []);
  const res = await pool.run('DELETE FROM x', []);
  expect(rows).toEqual([{ n: 1 }]);
  expect(res).toEqual({ changes: 1 });
  expect(pool.acquired).toHaveLength(2);
  for (const querier of pool.acquired) {
    expect(querier.release).toHaveBeenCalledTimes(1);
  }
});

it('concurrent all() calls each acquire their own connection', async () => {
  const pool = new CountingSqlPool(createSqlStubQuerier);
  await Promise.all([pool.all('SELECT 1'), pool.all('SELECT 2')]);
  expect(pool.acquired).toHaveLength(2);
});

/**
 * The pattern the docs recommend, and the one the implementation broke: `querier.transaction` used to
 * release inside the callback, so `withQuerier` released a second time and any work after the
 * transactional section ran on a connection already back in the pool.
 */
it('releases exactly once when a transaction runs inside withQuerier', async () => {
  const querier = createMockQuerier();
  const pool = createMockQuerierPool(new PostgresDialect(), async () => querier);

  await pool.withQuerier(async (acquired) => {
    await acquired.findOne(User, {});
    await acquired.transaction(async () => {
      await acquired.insertOne(User, { name: 'John' });
    });
    // Still usable afterwards: the connection is the caller's until `withQuerier` returns.
    return acquired.count(User);
  });

  expect(querier.release).toHaveBeenCalledTimes(1);
  expect(querier.beginTransaction).toHaveBeenCalledTimes(1);
  expect(querier.commitTransaction).toHaveBeenCalledTimes(1);
  // Still reached the connection after the commit, rather than one already back in the pool.
  expect(querier.count.mock.invocationCallOrder[0]).toBeGreaterThan(
    querier.commitTransaction.mock.invocationCallOrder[0],
  );
});
