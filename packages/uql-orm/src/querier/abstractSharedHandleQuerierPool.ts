import type { AbstractSqlDialect } from '../dialect/index.js';
import type { SqlQuerier } from '../type/index.js';
import { AbstractSqlQuerierPool } from './abstractSqlQuerierPool.js';

/**
 * Base pool for an engine that gives one connection per database and keeps it open for the pool's
 * lifetime: every local SQLite driver, the embedded Turso engine, and PGlite.
 *
 * The handle is shared, but each acquisition gets its own querier, so transaction state stays per unit
 * of work. That state is not *isolated*, which is the one way these differ from a real pool: there is a
 * single connection under every querier, so two of them cannot hold independent transactions, and a
 * unit of work that needs one needs its own pool and therefore its own database.
 *
 * What a second `BEGIN` then does is the engine's, not this class's: SQLite and the embedded Turso
 * engine both refuse it ("cannot start a transaction within a transaction"), while PGlite accepts it
 * into the transaction already open - see {@link PgliteQuerierPool}, which is why that one is worth
 * saying out loud.
 *
 * Subclasses supply only how to open the handle and how to wrap it, the way {@link AbstractPgQuerierPool}
 * takes `buildQuerier` alone. The lazy open and the close were written out once per pool before, along
 * with three partial copies of the paragraph above.
 *
 * @remarks Deliberately not re-exported from `querier/index.ts`, which the root entry point re-exports:
 * only the three driver entries need this, and each imports it by path, as `postgres/abstractPgQuerier.ts`
 * is imported.
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
