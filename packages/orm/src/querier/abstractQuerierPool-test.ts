import { expect } from 'vitest';
import type { AbstractDialect } from '../dialect/index.js';
import { AbstractQuerier } from '../querier/index.js';
import { type Spec, User } from '../test/index.js';
import type { Querier } from '../type/index.js';
import type { AbstractQuerierPool } from './abstractQuerierPool.js';

type AnyQuerierPool = AbstractQuerierPool<Querier, AbstractDialect>;

/** What every pool does, whichever backend it reaches. */
export class QuerierPoolIt<P extends AnyQuerierPool = AnyQuerierPool> implements Spec {
  protected readonly pool: P;

  /** Takes the pool's factory, so a case can end a pool of its own. */
  constructor(protected readonly createPool: () => P) {
    this.pool = createPool();
  }

  async afterAll() {
    await this.pool.end();
  }

  async shouldGetQuerier() {
    const querier = await this.pool.getQuerier();
    expect(querier).toBeInstanceOf(AbstractQuerier);
    expect(querier.hasOpenTransaction).toBe(false);
    await querier.release();
  }

  /** Hands back what the callback returns, and releases the querier it lent. */
  async shouldWithQuerierReleaseOnSuccess() {
    const used = await this.pool.withQuerier(async (querier) => querier);

    expect(used).toBeInstanceOf(AbstractQuerier);
    await expect(this.statementOn(used)).rejects.toThrow('querier already released');
  }

  async shouldWithQuerierReleaseOnError() {
    const { promise: used, resolve } = Promise.withResolvers<Querier>();

    await expect(
      this.pool.withQuerier(async (querier) => {
        resolve(querier);
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');

    await expect(this.statementOn(await used)).rejects.toThrow('querier already released');
  }

  /** A shared instance would leak transaction state across concurrent units of work. */
  async shouldAcquireDistinctQueriersPerCall() {
    const querier1 = await this.pool.getQuerier();
    const querier2 = await this.pool.getQuerier();
    expect(querier2).not.toBe(querier1);
    await querier1.release();
    await querier2.release();
  }

  /**
   * A unit of work started while a pool transaction is open (a pool read helper, say) gets its own
   * querier: releasing the transaction's querier would throw and roll it back.
   */
  async shouldRunNestedUnitOfWorkInsideTransaction() {
    const result = await this.pool.transaction(async (outer) => {
      expect(outer.hasOpenTransaction).toBe(true);
      return this.pool.withQuerier(async (inner) => {
        expect(inner).not.toBe(outer);
        return 42;
      });
    });
    expect(result).toBe(42);
  }

  /** An ended pool closed what it held, so a querier taken before the end has nothing left to run on. */
  async shouldRefuseAStatementAfterEnd() {
    const pool = this.createPool();
    const querier = await pool.getQuerier();

    await pool.end();

    await expect(this.statementOn(querier)).rejects.toThrow();
  }

  /** A statement any working pool runs: a count, which on MongoDB needs no collection to exist. */
  protected statementOn(querier: Querier): Promise<unknown> {
    return querier.count(User, {});
  }
}
