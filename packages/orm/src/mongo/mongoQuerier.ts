import type { Db } from 'mongodb';
import { withQuerierOfKind } from '../migrate/acquireQuerierForMigrations.js';
import { isSqlQuerier, type Querier, type QuerierPool } from '../type/index.js';

/**
 * Extended querier interface for MongoDB execution.
 */
export interface MongoQuerier extends Querier {
  /**
   * The MongoDB database instance.
   */
  readonly db: Db;
}

/**
 * Type guard for a querier over a MongoDB database. A handle alone does not tell: the SQLite, D1 and
 * Turso queriers carry a `db` of their own.
 */
export function isMongoQuerier(querier: Querier): querier is MongoQuerier {
  return 'db' in querier && !isSqlQuerier(querier);
}

/** Runs `task` on a migration querier over MongoDB. `requiredBy` names the caller in the error. */
export function withMongoQuerierForMigrations<T>(
  pool: QuerierPool,
  requiredBy: string,
  task: (querier: MongoQuerier) => Promise<T>,
): Promise<T> {
  return withQuerierOfKind(pool, isMongoQuerier, `${requiredBy} requires a MongoDB querier`, task);
}
