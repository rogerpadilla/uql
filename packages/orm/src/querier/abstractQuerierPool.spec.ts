import { expect, it, vi } from 'vitest';
import { getContext, withContext } from '../context/context.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerier, createMockQuerierPool, User } from '../test/index.js';
import type { Querier, SqlQuerier, UqlContext } from '../type/index.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';
import { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/** Pool that hands out a fresh querier per acquisition and records how many it acquired. */
class CountingPool<Q extends Querier> extends AbstractQuerierPool<Q, PostgresDialect> {
  readonly acquired: Q[] = [];
  constructor(private readonly make: () => Q) {
    super(new PostgresDialect());
  }
  override getQuerier(): Promise<Q> {
    const querier = this.make();
    this.acquired.push(querier);
    return Promise.resolve(querier);
  }
  override end(): Promise<void> {
    return Promise.resolve();
  }
}

it('should run the callback under the given context and release the querier', async () => {
  const querier = createMockQuerier();
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

it('should leave the ambient context untouched given no context', async () => {
  const pool = new CountingPool(() => createMockQuerier());
  let seen: UqlContext | undefined = { sentinel: true };
  await pool.withQuerier(async () => {
    seen = getContext();
  });
  expect(seen).toBeUndefined();
});

it('should release the querier when the callback throws under a context', async () => {
  const querier = createMockQuerier();
  const pool = new CountingPool(() => querier);
  await expect(
    pool.withQuerier(
      async () => {
        throw new TypeError('boom');
      },
      { context: { tenantId: 5 } },
    ),
  ).rejects.toThrow('boom');
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('should run a transaction under the given context', async () => {
  const querier = createMockQuerier();
  const transaction = vi.spyOn(querier, 'transaction');
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
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(getContext()).toBeUndefined();
});

class Item {
  id?: number;
}

/** A querier whose reads answer canned rows. */
function createReadStubQuerier() {
  const querier = createMockQuerier();
  querier.findOneById.mockResolvedValue({ id: 1 });
  querier.findOne.mockResolvedValue({ id: 1 });
  querier.findMany.mockResolvedValue([{ id: 1 }]);
  querier.findManyAndCount.mockResolvedValue([[{ id: 1 }], 1]);
  querier.count.mockResolvedValue(7);
  querier.aggregate.mockResolvedValue([{ total: 3 }]);
  return querier;
}

it('should delegate findMany to a querier of its own, and release it', async () => {
  const querier = createReadStubQuerier();
  const pool = new CountingPool(() => querier);
  const result = await pool.findMany(Item, { $where: { id: 1 } });
  expect(result).toEqual([{ id: 1 }]);
  expect(querier.findMany).toHaveBeenCalledWith(Item, { $where: { id: 1 } }, undefined);
  expect(pool.acquired).toHaveLength(1);
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('should acquire a connection per concurrent read, in parallel', async () => {
  const pool = new CountingPool(createReadStubQuerier);
  const [rows, total] = await Promise.all([pool.findMany(Item, {}), pool.count(Item, {})]);
  expect(rows).toEqual([{ id: 1 }]);
  expect(total).toBe(7);
  // Two separate connections were acquired - the basis for genuine parallelism.
  expect(pool.acquired).toHaveLength(2);
  for (const querier of pool.acquired) {
    expect(querier.release).toHaveBeenCalledTimes(1);
  }
});

it('should delegate every read to a fresh querier, and release it', async () => {
  const pool = new CountingPool(createReadStubQuerier);
  const entity = Item;

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

it('should delegate exists and estimatedCount to a fresh querier, and release it', async () => {
  const pool = new CountingPool(() => {
    const querier = createMockQuerier();
    querier.exists.mockResolvedValue(true);
    querier.estimatedCount.mockResolvedValue(7);
    return querier;
  });

  expect(await pool.exists(User, { $where: { name: 'a' } })).toBe(true);
  expect(await pool.estimatedCount(User)).toBe(7);

  const [exists, estimated] = pool.acquired;
  expect(exists.exists).toHaveBeenCalledWith(User, { $where: { name: 'a' } }, undefined);
  expect(estimated.estimatedCount).toHaveBeenCalledWith(User);
  expect(exists.release).toHaveBeenCalledTimes(1);
  expect(estimated.release).toHaveBeenCalledTimes(1);
});

/** A querier whose writes answer canned results, and whose stream yields two rows. */
function createWriteStubQuerier() {
  const querier = createMockQuerier();
  querier.insertOne.mockResolvedValue(1);
  querier.insertMany.mockResolvedValue([1, 2]);
  querier.updateOneById.mockResolvedValue(1);
  querier.updateMany.mockResolvedValue(2);
  querier.upsertOne.mockResolvedValue({ changes: 1 });
  querier.upsertMany.mockResolvedValue({ changes: 2 });
  querier.saveOne.mockResolvedValue(1);
  querier.saveMany.mockResolvedValue([1, 2]);
  querier.deleteOneById.mockResolvedValue(1);
  querier.deleteMany.mockResolvedValue(2);
  querier.restoreOneById.mockResolvedValue(1);
  querier.restoreMany.mockResolvedValue(2);
  querier.findManyStream.mockImplementation(async function* () {
    yield { id: 1 };
    yield { id: 2 };
  });
  return querier;
}

it('should delegate every write to a fresh querier, and release it', async () => {
  const pool = new CountingPool(createWriteStubQuerier);
  const entity = Item;

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

it('should release the connection when a write throws', async () => {
  const querier = createWriteStubQuerier();
  querier.insertOne.mockRejectedValue(new Error('constraint'));
  const pool = new CountingPool(() => querier);

  await expect(pool.insertOne(Item, { id: 1 })).rejects.toThrow('constraint');
  expect(querier.release).toHaveBeenCalledTimes(1);
});

it('should hold one connection for a whole stream, and dispose of it at the end', async () => {
  const querier = createWriteStubQuerier();
  const pool = new CountingPool(() => querier);
  const seen: unknown[] = [];

  for await (const row of pool.findManyStream(Item, {})) {
    seen.push(row);
  }

  expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
  expect(pool.acquired).toHaveLength(1);
  expect(querier[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
});

it("should dispose of a stream's connection when the consumer stops early", async () => {
  const querier = createWriteStubQuerier();
  const pool = new CountingPool(() => querier);

  for await (const _row of pool.findManyStream(Item, {})) {
    break;
  }

  expect(querier[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
});

it('should run pool reads under the ambient context', async () => {
  const querier = createReadStubQuerier();
  const pool = new CountingPool(() => querier);
  let seen: UqlContext | undefined;
  querier.count.mockImplementation(async () => {
    seen = getContext();
    return 0;
  });
  await withContext({ tenantId: 9 }, () => pool.count(Item, {}));
  expect(seen).toEqual({ tenantId: 9 });
});

/** A SQL querier whose raw reads and writes answer canned results. */
function createSqlStubQuerier() {
  return createMockQuerier({
    all: vi.fn().mockResolvedValue([{ n: 1 }]),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
    dialect: new PostgresDialect(),
  });
}

class CountingSqlPool<Q extends SqlQuerier> extends AbstractSqlQuerierPool<Q, PostgresDialect> {
  readonly acquired: Q[] = [];
  constructor(private readonly make: () => Q) {
    super(new PostgresDialect());
  }
  override getQuerier(): Promise<Q> {
    const querier = this.make();
    this.acquired.push(querier);
    return Promise.resolve(querier);
  }
  override end(): Promise<void> {
    return Promise.resolve();
  }
}

it('should delegate all and run to a querier of their own, and release it', async () => {
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

it('should acquire a connection per concurrent all()', async () => {
  const pool = new CountingSqlPool(createSqlStubQuerier);
  await Promise.all([pool.all('SELECT 1'), pool.all('SELECT 2')]);
  expect(pool.acquired).toHaveLength(2);
});

/**
 * The pattern the docs recommend: a transaction inside `withQuerier` leaves the release to `withQuerier`,
 * so work after the transaction still runs on the caller's connection.
 */
it('should release exactly once when a transaction runs inside withQuerier', async () => {
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
