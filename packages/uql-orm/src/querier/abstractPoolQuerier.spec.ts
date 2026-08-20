import { describe, expect, it } from 'vitest';
import { SqliteDialect } from '../sqlite/sqliteDialect.js';
import type { QueryUpdateResult } from '../type/index.js';
import { AbstractPoolQuerier } from './abstractPoolQuerier.js';

/** Stands in for a pooled driver connection: `release` hands it back, and can be made to fail. */
type Conn = { readonly id: number; release: () => Promise<void> };

/**
 * Pool querier over counted fake connections, so a spec can assert how many were taken from the pool
 * and how many came back. No database: `internalAll`/`internalRun` only prove a statement was reached.
 */
class StubPoolQuerier extends AbstractPoolQuerier<Conn> {
  readonly handedBack: number[] = [];
  connects = 0;
  releaseFails = false;

  constructor() {
    super(new SqliteDialect({}), async () => {
      this.connects += 1;
      return { id: this.connects, release: async () => {} };
    });
  }

  protected override async releaseConn(conn: Conn) {
    if (this.releaseFails) {
      throw new Error('pool refused the connection');
    }
    this.handedBack.push(conn.id);
  }

  protected override async internalAll<T>(): Promise<T[]> {
    return [] as T[];
  }

  protected override async *internalStream<T>(): AsyncIterable<T> {}

  protected override async internalRun(): Promise<QueryUpdateResult> {
    return { changes: 0 };
  }

  /** Exposed so a spec can drive the connect path without a real statement. */
  async connectNow() {
    return this.lazyConnect();
  }
}

describe('AbstractPoolQuerier connection lifecycle', () => {
  /**
   * `lazyConnect` is `this.conn ??= await this.connect()` and releasing clears `conn`, so a stray call
   * after release used to take a *second* connection from the pool with nobody left to give it back:
   * the code that owned the release had already finished. Every occurrence cost the pool a connection
   * permanently, and after `max` of them every acquire blocks forever.
   */
  it('should refuse to reconnect after being released', async () => {
    const querier = new StubPoolQuerier();
    await querier.connectNow();
    await querier.release();

    await expect(querier.all('SELECT 1')).rejects.toThrow('querier already released');

    expect(querier.connects).toBe(1);
    expect(querier.handedBack).toEqual([1]);
  });

  /**
   * The handle used to be cleared only after `releaseConn` resolved, so a pool that rejected the
   * hand-back left the querier pointing at a connection it had already tried to return. A later release
   * then returned it twice, which pg reports as `Release called on client which has already been
   * released to the pool`.
   */
  it('should drop the connection even when handing it back fails', async () => {
    const querier = new StubPoolQuerier();
    await querier.connectNow();
    querier.releaseFails = true;

    await expect(querier.release()).rejects.toThrow('pool refused the connection');

    querier.releaseFails = false;
    await expect(querier.release()).resolves.toBeUndefined();
    expect(querier.handedBack).toEqual([]);
  });

  /** A querier that never connected has nothing to hand back, and a second release nothing to repeat. */
  it('should release idempotently, with or without a connection', async () => {
    const never = new StubPoolQuerier();
    await expect(never.release()).resolves.toBeUndefined();
    expect(never.connects).toBe(0);

    const used = new StubPoolQuerier();
    await used.connectNow();
    await used.release();
    await expect(used.release()).resolves.toBeUndefined();
    expect(used.handedBack).toEqual([1]);
  });
});
