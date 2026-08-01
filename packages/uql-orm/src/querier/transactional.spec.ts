import { afterEach, describe, expect, it, vi } from 'vitest';
import { setQuerierPool } from '../options.js';
import { PostgresDialect } from '../postgres/postgresDialect.js';
import { createMockQuerierPool } from '../test/mockQuerierPool.js';
import type { Querier, QuerierPool } from '../type/index.js';
import { AbstractQuerier } from './abstractQuerier.js';
import { currentQuerier, currentQuerierIfAny } from './querierContext.js';
import { Transactional } from './transactional.js';

/** A querier that records the transaction calls made against it. */
function createQuerier() {
  const calls: string[] = [];
  const querier = {
    hasOpenTransaction: false,
    // The real sequencing, driven by the recorders below, so `calls` shows what the ORM actually does.
    transaction: AbstractQuerier.prototype.transaction,
    async beginTransaction(opts?: { isolationLevel?: string }) {
      calls.push(opts?.isolationLevel ? `begin:${opts.isolationLevel}` : 'begin');
      querier.hasOpenTransaction = true;
    },
    async commitTransaction() {
      calls.push('commit');
      querier.hasOpenTransaction = false;
    },
    async rollbackTransaction() {
      calls.push('rollback');
      querier.hasOpenTransaction = false;
    },
    async release() {
      calls.push('release');
    },
  };
  return { calls, querier: querier as unknown as Querier };
}

function createPool(querier: Querier): QuerierPool {
  // A spy, since MockQuerierPool keeps the exact function passed and specs assert on the acquisitions.
  return createMockQuerierPool(new PostgresDialect(), vi.fn().mockResolvedValue(querier));
}

describe('@Transactional', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a transaction, publishes the querier, then commits and releases', async () => {
    const { calls, querier } = createQuerier();
    let seen: Querier | undefined;

    class Service {
      @Transactional({ pool: createPool(querier) })
      async save() {
        seen = currentQuerier();
      }
    }

    await new Service().save();

    expect(seen).toBe(querier);
    expect(calls).toEqual(['begin', 'commit', 'release']);
  });

  it('rolls back and still releases when the method throws', async () => {
    const { calls, querier } = createQuerier();

    class Service {
      @Transactional({ pool: createPool(querier) })
      async save() {
        throw new Error('boom');
      }
    }

    await expect(new Service().save()).rejects.toThrow('boom');
    expect(calls).toEqual(['begin', 'rollback', 'release']);
  });

  it('passes the isolation level through', async () => {
    const { calls, querier } = createQuerier();

    class Service {
      @Transactional({ pool: createPool(querier), isolationLevel: 'serializable' })
      async save() {}
    }

    await new Service().save();
    expect(calls).toEqual(['begin:serializable', 'commit', 'release']);
  });

  it('joins the transaction already in flight instead of opening a second one', async () => {
    const { calls, querier } = createQuerier();
    const pool = createPool(querier);

    class Service {
      @Transactional({ pool })
      async outer() {
        await this.inner();
      }

      @Transactional({ pool })
      async inner() {
        expect(currentQuerier()).toBe(querier);
      }
    }

    await new Service().outer();

    // One begin/commit/release for the whole flow: the nested call must not take a second querier.
    expect(calls).toEqual(['begin', 'commit', 'release']);
    expect(pool.getQuerier).toHaveBeenCalledTimes(1);
  });

  it("does not begin a transaction under 'supported' propagation", async () => {
    const { calls, querier } = createQuerier();

    class Service {
      @Transactional({ pool: createPool(querier), propagation: 'supported' })
      async save() {
        expect(currentQuerier()).toBe(querier);
      }
    }

    await new Service().save();
    expect(calls).toEqual(['release']);
  });

  it('falls back to the default pool when none is given', async () => {
    const { calls, querier } = createQuerier();
    setQuerierPool(createPool(querier));

    class Service {
      @Transactional()
      async save() {}
    }

    await new Service().save();
    expect(calls).toEqual(['begin', 'commit', 'release']);
  });

  // The signature already rejects a non-async method, so this only covers the runtime backstop for
  // callers coming from plain JavaScript, where no such check exists.
  it('refuses a synchronous method at decoration time', () => {
    expect(() => {
      class Service {
        // @ts-expect-error a sync method is also a compile error; this asserts the runtime guard
        @Transactional()
        save() {}
      }
      return Service;
    }).toThrow(/needs an async method/);
  });

  it('reports a clear error when no transaction is active', () => {
    expect(currentQuerierIfAny()).toBeUndefined();
    expect(() => currentQuerier()).toThrow(/found no active querier/);
  });
});
