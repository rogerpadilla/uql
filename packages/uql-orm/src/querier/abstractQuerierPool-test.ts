import { expect } from 'vitest';
import type { AbstractDialect } from '../dialect/index.js';
import { AbstractQuerier } from '../querier/index.js';
import type { Spec } from '../test/index.js';
import type { Querier } from '../type/index.js';
import type { AbstractQuerierPool } from './abstractQuerierPool.js';

export abstract class AbstractQuerierPoolIt<Q extends Querier> implements Spec {
  constructor(protected pool: AbstractQuerierPool<Q, AbstractDialect>) {}

  async afterAll() {
    await this.pool.end();
  }

  async shouldGetQuerier() {
    const querier = await this.pool.getQuerier();
    expect(querier).toBeInstanceOf(AbstractQuerier);
    expect(querier.hasOpenTransaction).toBeFalsy();
    await querier.release();
  }

  async shouldWithQuerierReturnResult() {
    const result = await this.pool.withQuerier(async (querier) => {
      expect(querier).toBeInstanceOf(AbstractQuerier);
      return 42;
    });
    expect(result).toBe(42);
  }

  async shouldWithQuerierReleaseOnSuccess() {
    let capturedQuerier: Q | undefined;
    await this.pool.withQuerier(async (querier) => {
      capturedQuerier = querier;
    });
    // After withQuerier completes, requesting a new querier should work (pool not exhausted)
    const nextQuerier = await this.pool.getQuerier();
    expect(nextQuerier).toBeInstanceOf(AbstractQuerier);
    await nextQuerier.release();
  }

  async shouldWithQuerierReleaseOnError() {
    const error = new Error('test error');
    await expect(
      this.pool.withQuerier(async () => {
        throw error;
      }),
    ).rejects.toThrow('test error');
    // Pool should still be usable after error
    const querier = await this.pool.getQuerier();
    expect(querier).toBeInstanceOf(AbstractQuerier);
    await querier.release();
  }

  async shouldAcquireDistinctQueriersPerCall() {
    // A shared instance would leak transaction state across concurrent units of work.
    const querier1 = await this.pool.getQuerier();
    const querier2 = await this.pool.getQuerier();
    expect(querier2).not.toBe(querier1);
    await querier1.release();
    await querier2.release();
  }

  async shouldRunNestedUnitOfWorkInsideTransaction() {
    // A unit of work started while a pool transaction is open (e.g. a pool read helper) must get
    // its own querier - releasing the transaction's querier would throw and roll it back.
    const result = await this.pool.transaction(async (outer) => {
      expect(outer.hasOpenTransaction).toBe(true);
      return this.pool.withQuerier(async (inner) => {
        expect(inner).not.toBe(outer);
        return 42;
      });
    });
    expect(result).toBe(42);
  }
}
