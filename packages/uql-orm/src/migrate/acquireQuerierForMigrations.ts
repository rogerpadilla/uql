import type { Querier, QuerierPool } from '../type/index.js';

/**
 * Querier used for schema migrations and the migration journal (`DatabaseMigrationStorage`).
 *
 * Pools may override {@link QuerierPool.getMigrationQuerier} so DDL runs on a different target than
 * app traffic (e.g. LibSQL embedded replica: local `file:` + remote `syncUrl`).
 */
export async function acquireQuerierForMigrations(pool: QuerierPool): Promise<Querier> {
  return (await pool.getMigrationQuerier?.()) ?? (await pool.getQuerier());
}
