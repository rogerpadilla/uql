import type { AbstractSqlDialect } from '../dialect/abstractSqlDialect.js';
import type { QuerierPool, QuerySql, SqlDialectName, SqlQuerier } from '../type/index.js';
import { sql } from '../util/sql.js';
import { fnv1a } from '../util/string.util.js';
import { UqlUsageError } from '../util/uqlError.js';
import { withSqlQuerierForMigrations } from './acquireQuerierForMigrations.js';
import { createMigrationsTable, journalIds, LOCK_RECORD } from './storage/databaseStorage.js';

/** How long `up` and `down` wait for the lock another run holds, unless told otherwise. */
export const DEFAULT_LOCK_TIMEOUT = 5 * 60_000;

/** How often a run waiting for the lock asks for it again. */
const POLL_INTERVAL = 250;

/** The statements taking and releasing a named lock: `acquire` takes it without waiting, answering a row only when it did. */
type NamedLockSql = { readonly acquire: QuerySql; readonly release: QuerySql };

/** MySQL's lock names are server-wide, so the database prefixes each, cut to the 64 characters it takes. */
const mysqlLock = (name: string): NamedLockSql => {
  const lock = sql`LEFT(CONCAT(DATABASE(), '.', ${name}), 64)`;
  return { acquire: sql`SELECT 1 FROM DUAL WHERE GET_LOCK(${lock}, 0) = 1`, release: sql`DO RELEASE_LOCK(${lock})` };
};

/** Each engine's named lock, as `features.namedLocks` says what holds it. None on CockroachDB and SQLite. */
const NAMED_LOCK_SQL: Readonly<Record<SqlDialectName, ((name: string) => NamedLockSql) | undefined>> = {
  postgres: (name) => {
    const key = fnv1a(name);
    return {
      acquire: sql`SELECT 1 WHERE pg_try_advisory_lock(${key})`,
      release: sql`SELECT pg_advisory_unlock(${key})`,
    };
  },
  cockroachdb: undefined,
  mysql: mysqlLock,
  mariadb: mysqlLock,
  mssql: (name) => ({
    acquire: sql`DECLARE @_uql_lock INT;
      EXEC @_uql_lock = sp_getapplock @Resource = ${name}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
      SELECT 1 WHERE @_uql_lock >= 0`,
    release: sql`EXEC sp_releaseapplock @Resource = ${name}, @LockOwner = 'Transaction'`,
  }),
  sqlite: undefined,
};

/** The statements of the lock named `name` on `dialect`'s engine, where it has one its sessions can hold. */
export function namedLockSql(dialect: AbstractSqlDialect, name: string): NamedLockSql | undefined {
  return dialect.features.namedLocks ? NAMED_LOCK_SQL[dialect.dialectName]?.(name) : undefined;
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
    await lock.release().catch(() => {});
    throw error;
  });
  await lock.release();
  return result;
}

/**
 * Runs `work` holding the lock `options` names, the journal created first: on `querier`'s session, in a
 * transaction of its own kept open meanwhile, or, where the engine has no named lock, by a record in the
 * journal, which then has to exist before the lock, created by whichever run gets there.
 */
export async function withSqlMigrationLock<T>(
  pool: QuerierPool,
  querier: SqlQuerier,
  options: MigrationLockOptions,
  work: () => Promise<T>,
): Promise<T> {
  const { dialect } = querier;
  const journaled = async () => {
    await createMigrationsTable(querier, options.name);
    return work();
  };
  const sql = namedLockSql(dialect, options.name);
  if (!sql) {
    await createMigrationsTable(querier, options.name);
    return holdingLock(sqlRecordLock(querier, options.name), options, work);
  }
  if (dialect.features.namedLocks === 'session') {
    return holdingLock(statementLock(querier, sql), options, journaled);
  }
  return withSqlQuerierForMigrations(pool, 'Migrator', (own) =>
    own.transaction(() => holdingLock(statementLock(own, sql), options, journaled)),
  );
}

/** The engine's named lock, which it releases itself should the connection close. */
function statementLock(querier: SqlQuerier, { acquire, release }: NamedLockSql): MigrationLock {
  return {
    take: async () => (await querier.all(acquire)).length > 0,
    release: () => querier.run(release),
    stuck: 'The engine releases it once that run ends or its connection closes.',
  };
}

/** What to do about a lock record no run released, which only a person can tell is stale. */
export const staleRecord = (what: string, journal: string) =>
  `If none is running, one stopped before releasing it: delete the ${what} '${LOCK_RECORD}' from "${journal}".`;

/**
 * The journal's {@link LOCK_RECORD} row, inserted only where it is absent, which one run alone can: SQLite
 * writes one statement at a time, and CockroachDB serializes them.
 */
function sqlRecordLock(querier: SqlQuerier, journal: string): MigrationLock {
  const { table, name } = journalIds(querier, journal);
  return {
    take: async () => {
      const { changes } =
        await querier.run`INSERT INTO ${table} (${name}) SELECT ${LOCK_RECORD} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${name} = ${LOCK_RECORD})`;
      return changes === 1;
    },
    release: () => querier.run`DELETE FROM ${table} WHERE ${name} = ${LOCK_RECORD}`,
    stuck: staleRecord('row', journal),
  };
}
