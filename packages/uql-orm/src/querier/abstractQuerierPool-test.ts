import { expect } from 'vitest';
import { AbstractQuerier } from '../querier/index.js';
import type { Spec } from '../test/index.js';
import type { Querier } from '../type/index.js';
import type { AbstractQuerierPool } from './abstractQuerierPool.js';

export abstract class AbstractQuerierPoolIt<Q extends Querier> implements Spec {
  constructor(protected pool: AbstractQuerierPool<Q>) {}

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
}
