import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlQuerier } from '../type/index.js';
import { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/**
 * A pool over one handle kept for its lifetime: a local SQLite file, the embedded Turso engine, PGlite, or a
 * libSQL client. Each acquisition gets its own querier, but on one connection two cannot hold separate
 * transactions: a unit of work needing its own needs its own pool. Imported by path, not from `querier/index.ts`.
 */
export abstract class AbstractSharedHandleQuerierPool<
  DB extends { close(): unknown },
  Q extends SqlQuerier,
  D extends AbstractSqlDialect,
> extends AbstractSqlQuerierPool<Q, D> {
  /**
   * The open, not the handle: `db ??= await openDb()` reads before the await and assigns after, so
   * callers arriving while the first open is in flight each start one of their own. The extra handles
   * are then unreachable and never closed, and on an in-memory database they are separate databases,
   * so a querier built on one writes where nothing else will ever read.
   */
  private opening?: Promise<DB>;

  /** Opens the one connection. Called on the first acquisition, and again after an {@link end}. */
  protected abstract openDb(): Promise<DB>;

  /** Wraps the shared handle in a querier: the only thing that varies between these pools. */
  protected abstract buildQuerier(db: DB): Q;

  async getQuerier() {
    // Cleared on failure, so a driver that could not start once is retried rather than refused forever.
    this.opening ??= this.openDb().catch((err: unknown) => {
      this.opening = undefined;
      throw err;
    });
    return this.buildQuerier(await this.opening);
  }

  async end() {
    const opening = this.opening;
    this.opening = undefined;
    // An open still in flight is awaited rather than abandoned: closing is what releases its file or port.
    // One that failed leaves nothing to close, and `getQuerier` already reported it to its own caller.
    const db = await opening?.catch(() => undefined);
    await db?.close();
  }
}
