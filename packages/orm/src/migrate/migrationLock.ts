import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import type { QuerierPool, QuerySql, SqlDialectFeatures, SqlDialectName, SqlQuerier } from '../type/index.js';
import { noop } from '../util/object.util.js';
import { sql } from '../util/sql.js';
import { fnv1a } from '../util/string.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import { createMigrationsTable, journalIds, LOCK_RECORD } from './storage/databaseStorage.js';

/** How long `up` and `down` wait for the lock another run holds, unless told otherwise. */
export const DEFAULT_LOCK_TIMEOUT = 5 * 60_000;

/** How often a run waiting for the lock asks for it again. */
const POLL_INTERVAL = 250;

/** The statements taking and releasing a lock: `acquire` answers a row only when it took it, never waiting. */
type LockSql = { readonly acquire: QuerySql; readonly release: QuerySql };

/** MySQL's lock names are server-wide, so the database prefixes each, cut to the 64 characters it takes. */
const mysqlLock = (name: string): LockSql => {
  const lock = sql`LEFT(CONCAT(DATABASE(), '.', ${name}), 64)`;
  return { acquire: sql`SELECT 1 FROM DUAL WHERE GET_LOCK(${lock}, 0) = 1`, release: sql`DO RELEASE_LOCK(${lock})` };
};

/**
 * The journal's lock row, inserted only where it is absent, which one run alone can: the lock of an engine with no
 * named one. CockroachDB's write to it cannot stay uncommitted for the run, which a function it creates would wait on.
 */
const journalRowLock = (name: string): LockSql => {
  const { table, name: column } = journalIds(name);
  return {
    acquire: sql`INSERT INTO ${table} (${column}) SELECT ${LOCK_RECORD}
      WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ${LOCK_RECORD}) RETURNING 1`,
    release: sql`DELETE FROM ${table} WHERE ${column} = ${LOCK_RECORD}`,
  };
};

/** Each engine's lock on the journal `name`, held by what `features.namedLocks` says. */
const LOCK_SQL: Readonly<Record<SqlDialectName, (name: string) => LockSql>> = {
  postgres: (name) => {
    const key = fnv1a(name);
    return {
      acquire: sql`SELECT 1 WHERE pg_try_advisory_lock(${key})`,
      release: sql`SELECT pg_advisory_unlock(${key})`,
    };
  },
  cockroachdb: journalRowLock,
  mysql: mysqlLock,
  mariadb: mysqlLock,
  mssql: (name) => ({
    acquire: sql`DECLARE @_uql_lock INT;
      EXEC @_uql_lock = sp_getapplock @Resource = ${name}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
      SELECT 1 WHERE @_uql_lock >= 0`,
    release: sql`EXEC sp_releaseapplock @Resource = ${name}, @LockOwner = 'Transaction'`,
  }),
  sqlite: journalRowLock,
};

/** The statements of the lock on the journal `name` as `dialect`'s engine holds it, PGlite's in the journal. */
export function lockSql(dialect: AbstractSqlDialect, name: string): LockSql {
  return dialect.features.namedLocks === 'journal' ? journalRowLock(name) : LOCK_SQL[dialect.dialectName](name);
}

/** The lock a run holds, named after its journal, and how long a second run waits for it. */
export type MigrationLockOptions = { readonly name: string; readonly timeout: number };

/** A lock as a run holds it. */
export type MigrationLock = {
  /** Takes the lock if it is free, answering whether it did; never waits. */
  take(): Promise<boolean>;
  release(): Promise<unknown>;
  /** What to do should it stay held, which the timeout says. */
  readonly stuck: string;
};

/**
 * Runs `work` holding `lock`, asking for it until `timeout` passes, and releasing it however `work` ends: a
 * release failing after `work` did is a consequence of its error, and never replaces it.
 */
export async function holdingLock<T>(
  lock: MigrationLock,
  { name, timeout }: MigrationLockOptions,
  work: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (!(await lock.take())) {
    if (Date.now() >= deadline) {
      throw new UqlUsageError(
        `Gave up after ${timeout}ms waiting for the migration lock on "${name}", which another run holds. ${lock.stuck}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
  const result = await work().catch(async (error: unknown) => {
    await lock.release().catch(noop);
    throw error;
  });
  await lock.release();
  return result;
}

/** What to do about a lock record no run released, which only a person can tell is stale. */
export const staleRecord = (what: string, journal: string) =>
  `If none is running, one stopped before releasing it: delete the ${what} '${LOCK_RECORD}' from "${journal}".`;

const ENGINE_RELEASES = 'The engine releases it once that run ends or its connection closes.';

/** What to do about a lock held too long, by what holds it. */
const STUCK: Readonly<Record<SqlDialectFeatures['namedLocks'], (journal: string) => string>> = {
  session: () => ENGINE_RELEASES,
  transaction: () => ENGINE_RELEASES,
  journal: (journal) => staleRecord('row', journal),
};

/**
 * Runs `work` holding the lock on the journal `options.name`, created first, where `features.namedLocks` says:
 * on `querier`'s session or in the journal, or in a transaction of its own kept open meanwhile.
 */
export async function withSqlMigrationLock<T>(
  pool: QuerierPool,
  querier: SqlQuerier,
  options: MigrationLockOptions,
  work: () => Promise<T>,
): Promise<T> {
  const { name } = options;
  const holder = querier.dialect.features.namedLocks;
  const stuck = STUCK[holder](name);
  await createMigrationsTable(querier, name);
  const statements = lockSql(querier.dialect, name);
  if (holder !== 'transaction') {
    return holdingLock(sqlLock(querier, statements, stuck), options, work);
  }
  return withSqlQuerierForMigrations(pool, 'Migrator', (own) =>
    own.transaction(() => holdingLock(sqlLock(own, statements, stuck), options, work)),
  );
}

/** The lock `statements` take and release on `querier`. */
function sqlLock(querier: SqlQuerier, { acquire, release }: LockSql, stuck: string): MigrationLock {
  return {
    take: async () => (await querier.all(acquire)).length > 0,
    release: () => querier.run(release),
    stuck,
  };
}
