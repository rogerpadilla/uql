import { AbstractQuerier } from 'nukak/querier';
import { Spec } from '../test/index.js';
import { Querier } from '../type/index.js';
import { AbstractQuerierPool } from './abstractQuerierPool.js';

export abstract class AbstractQuerierPoolIt<Q extends Querier> implements Spec {
  constructor(readonly pool: AbstractQuerierPool<Q>) {}

  async afterAll() {
    await this.pool.end();
  }

  async shouldGetQuerier() {
    const querier = await this.pool.getQuerier();
    expect(querier).toBeInstanceOf(AbstractQuerier);
    await querier.release();
  }

  async shouldRunTransaction() {
    const res = await this.pool.transaction(async (querier) => {
      expect(querier).toBeInstanceOf(AbstractQuerier);
      expect(querier.hasOpenTransaction).toBe(true);
      return 123;
    });
    expect(res).toBe(123);
  }
}
