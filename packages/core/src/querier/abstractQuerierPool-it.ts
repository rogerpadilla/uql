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
    expect(querier.hasOpenTransaction).toBeFalsy();
    await querier.release();
  }
}
