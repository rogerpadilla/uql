import { afterAll, expect } from 'bun:test';
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
}
