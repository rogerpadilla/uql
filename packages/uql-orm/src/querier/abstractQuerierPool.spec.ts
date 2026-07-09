import { expect, it, vi } from 'vitest';
import { getContext } from '../context/context.js';
import type { AbstractDialect } from '../dialect/index.js';
import type { Querier, UqlContext } from '../type/index.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';

/** Minimal stub: only the members `withQuerier`/`transaction` touch. */
function createStubQuerier() {
  return {
    transaction: vi.fn((callback: () => Promise<unknown>) => callback()),
    release: vi.fn(async () => {}),
  } as unknown as Querier;
}

class TestPool extends AbstractQuerierPool<AbstractDialect, Querier> {
  constructor(readonly querier: Querier) {
    super(undefined as unknown as AbstractDialect);
  }

  override getQuerier(): Promise<Querier> {
    return Promise.resolve(this.querier);
  }

  override end(): Promise<void> {
    return Promise.resolve();
  }
}

it('withQuerier runs the callback under the given context and releases the querier', async () => {
  const querier = createStubQuerier();
  const pool = new TestPool(querier);
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
  const pool = new TestPool(createStubQuerier());
  let seen: UqlContext | undefined = { sentinel: true };
  await pool.withQuerier(async () => {
    seen = getContext();
  });
  expect(seen).toBeUndefined();
});

it('withQuerier releases the querier even when the callback throws under a context', async () => {
  const querier = createStubQuerier();
  const pool = new TestPool(querier);
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
  const pool = new TestPool(querier);
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
