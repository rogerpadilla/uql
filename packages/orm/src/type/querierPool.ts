import type { AbstractDialect, AbstractSqlDialect } from '../dialect/index.js';
import type { ExtraOptions, Querier, SqlQuerier, TransactionOptions } from './querier.js';
import type { UqlContext } from './query.js';
import type { UniversalQuerier } from './universalQuerier.js';

/** Options for a pool-level unit of work ({@link QuerierPool.withQuerier} / {@link QuerierPool.transaction}). */
export interface PoolRunOptions extends Pick<TransactionOptions, 'readOnly'> {
  /**
   * {@link UqlContext} to run the callback under, so policies and parameterized filters scope every
   * query inside it. Same mechanism as `withContext`, scoped to this unit of work - ideal where no
   * ambient request context exists (background pipelines, queue consumers, webhooks) and the tenant
   * is known locally: `pool.withQuerier((q) => q.findMany(Invoice, {}), { context: { tenantId } })`.
   */
  readonly context?: UqlContext;
}

/** A driver pool's options: uql's, and its read replicas, each a config of its own driver, opened as the primary is. */
export type DriverPoolOptions<C> = ExtraOptions & {
  readonly replicas?: readonly C[];
};

/**
 * A pool of queriers, and a {@link UniversalQuerier} itself: each call runs on a querier of its own, so
 * two calls are two units of work (use `transaction` to join them) and run in parallel where the backend
 * has more than one connection. An enclosing `withContext` scopes its calls. The `{ $entity }` form needs a querier.
 */
export interface QuerierPool<
  Q extends Querier = Querier,
  D extends AbstractDialect = AbstractDialect,
> extends UniversalQuerier {
  /**
   * Database dialect instance (single source of truth for dialect id and SQL/NoSQL behavior).
   */
  readonly dialect: D;

  /**
   * extra options
   */
  readonly extra?: ExtraOptions | undefined;

  /**
   * Default connection for application queries, transactions, and anything that should use the pool's primary URL.
   */
  getQuerier: () => Promise<Q>;

  /**
   * The connection schema changes and the migration journal run on: {@link getQuerier}'s, unless the pool's app
   * traffic runs elsewhere (a libSQL embedded replica's local file, Neon's HTTP).
   */
  getMigrationQuerier: () => Promise<Q>;

  /**
   * get a querier from the pool and run the given callback inside a transaction.
   */
  transaction<T>(callback: (querier: Q) => Promise<T>, opts?: TransactionOptions & PoolRunOptions): Promise<T>;

  /**
   * get a querier from the pool, run the given callback, and release the querier.
   */
  withQuerier<T>(callback: (querier: Q) => Promise<T>, opts?: PoolRunOptions): Promise<T>;

  /**
   * end the pool.
   */
  end(): Promise<void>;
}

/** A SQL pool, adding raw `all`/`run`, which no policy scopes but the database's own. */
export interface SqlQuerierPool<Q extends SqlQuerier = SqlQuerier, D extends AbstractSqlDialect = AbstractSqlDialect>
  extends QuerierPool<Q, D>, Pick<SqlQuerier, 'all' | 'run'> {}

/**
 * Represents a high-compatibility SQL pool shim for Node.js integrations (e.g., express-session).
 */
export interface SqlPoolCompat {
  /**
   * Standardized query executor compatible with pg, mysql2, etc.
   */
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;

  /**
   * Event listener support for common pool events.
   */
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}
