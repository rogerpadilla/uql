import { isSqlQuerier, type Querier, type QuerierPool, type SqlQuerier } from '../type/index.js';
import { UqlUsageError } from '../util/uqlError.js';

/**
 * Querier used for schema migrations and the migration journal.
 *
 * Pools may override {@link QuerierPool.getMigrationQuerier} so DDL runs on a different target than
 * app traffic (e.g. LibSQL embedded replica: local `file:` + remote `syncUrl`).
 */
export async function acquireQuerierForMigrations(pool: QuerierPool): Promise<Querier> {
  return (await pool.getMigrationQuerier?.()) ?? (await pool.getQuerier());
}

/** Runs `task` on a migration querier over SQL, and releases it. `requiredBy` names the caller in the error. */
export function withSqlQuerierForMigrations<T>(
  pool: QuerierPool,
  requiredBy: string,
  task: (querier: SqlQuerier) => Promise<T>,
): Promise<T> {
  return withQuerierOfKind(pool, isSqlQuerier, `${requiredBy} requires a SQL-based querier`, task);
}

/**
 * Runs `task` on a migration querier `isKind` accepts, refusing any other with `error`, and releases it whatever
 * happens. Not `pool.withQuerier`: migrations may run on another connection than app traffic.
 */
export async function withQuerierOfKind<Q extends Querier, T>(
  pool: QuerierPool,
  isKind: (querier: Querier) => querier is Q,
  error: string,
  task: (querier: Q) => Promise<T>,
): Promise<T> {
  const querier = await acquireQuerierForMigrations(pool);
  try {
    if (!isKind(querier)) {
      throw new UqlUsageError(error);
    }
    return await task(querier);
  } finally {
    await querier.release();
  }
}
