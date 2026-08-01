import { isSqlQuerier, type Querier, type QuerierPool, type SqlQuerier } from '../type/index.js';

/**
 * Querier used for schema migrations and the migration journal (`DatabaseMigrationStorage`).
 *
 * Pools may override {@link QuerierPool.getMigrationQuerier} so DDL runs on a different target than
 * app traffic (e.g. LibSQL embedded replica: local `file:` + remote `syncUrl`).
 */
export async function acquireQuerierForMigrations(pool: QuerierPool): Promise<Querier> {
  return (await pool.getMigrationQuerier?.()) ?? (await pool.getQuerier());
}

/**
 * Runs `task` on a migration querier and releases it, whatever happens.
 *
 * `pool.withQuerier` cannot serve here because migrations may run on a different connection than app
 * traffic, but the ownership rule is the same one: whoever acquires, releases.
 */
export async function withQuerierForMigrations<T>(pool: QuerierPool, task: (querier: Querier) => Promise<T>) {
  const querier = await acquireQuerierForMigrations(pool);
  try {
    return await task(querier);
  } finally {
    await querier.release();
  }
}

/**
 * Same, for the paths that only work against SQL. `requiredBy` names the caller in the error, which is
 * the only thing the five copies of this acquire-assert-release dance used to differ by.
 */
export function withSqlQuerierForMigrations<T>(
  pool: QuerierPool,
  requiredBy: string,
  task: (querier: SqlQuerier) => Promise<T>,
): Promise<T> {
  return withQuerierForMigrations(pool, (querier) => {
    if (!isSqlQuerier(querier)) {
      throw new TypeError(`${requiredBy} requires a SQL-based querier`);
    }
    return task(querier);
  });
}
