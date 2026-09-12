import type { LoggerWrapper } from '../util/logger.js';

/**
 * A driver error tagged by {@link enrichError}: `query` always, `values` only when the logger already
 * surfaces them, since they can carry PII or tokens into whatever serializes the error.
 */
export interface QueryError extends Error {
  query?: string;
  values?: unknown[];
}

/**
 * What a failed query ran into, named the same on every engine. `retryable` is a deadlock, a
 * serialization failure, a lock timeout or a busy database: the transaction can simply run again.
 */
export type QueryErrorKind =
  | 'uniqueViolation'
  | 'foreignKeyViolation'
  | 'notNullViolation'
  | 'checkViolation'
  | 'retryable';

/** The fields a driver reports its code on, each read as `unknown` since any driver may fill any one. */
type DriverErrorFields = {
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly number?: unknown;
  readonly errorLabels?: unknown;
  readonly message?: unknown;
};

/** Postgres, CockroachDB, PGlite and Neon in `code`; Bun SQL in `errno`. */
const SQLSTATE_KINDS: ReadonlyMap<unknown, QueryErrorKind> = new Map([
  ['23505', 'uniqueViolation'],
  ['23503', 'foreignKeyViolation'],
  ['23502', 'notNullViolation'],
  ['23514', 'checkViolation'],
  ['40P01', 'retryable'],
  ['40001', 'retryable'],
  ['55P03', 'retryable'],
]);

/** MySQL and MariaDB, in a numeric `errno`. */
const MYSQL_ERRNO_KINDS: ReadonlyMap<unknown, QueryErrorKind> = new Map([
  [1062, 'uniqueViolation'],
  [1451, 'foreignKeyViolation'],
  [1452, 'foreignKeyViolation'],
  [1048, 'notNullViolation'],
  [1364, 'notNullViolation'],
  [3819, 'checkViolation'],
  [4025, 'checkViolation'],
  [1213, 'retryable'],
  [1205, 'retryable'],
  [3572, 'retryable'],
]);

/** MSSQL, in `number`; its 547 is a check conflict too when the message names a CHECK constraint. */
const MSSQL_NUMBER_KINDS: ReadonlyMap<unknown, QueryErrorKind> = new Map([
  [2627, 'uniqueViolation'],
  [2601, 'uniqueViolation'],
  [547, 'foreignKeyViolation'],
  [515, 'notNullViolation'],
  [1205, 'retryable'],
  [1222, 'retryable'],
  [3960, 'retryable'],
]);

const MONGO_CODE_KINDS: ReadonlyMap<unknown, QueryErrorKind> = new Map([
  [11000, 'uniqueViolation'],
  [121, 'checkViolation'],
  [112, 'retryable'],
]);

/** The SQLite family reports only a message on every driver, D1 included. */
const SQLITE_MESSAGE_KINDS: readonly (readonly [string, QueryErrorKind])[] = [
  ['UNIQUE constraint failed', 'uniqueViolation'],
  ['FOREIGN KEY constraint failed', 'foreignKeyViolation'],
  ['NOT NULL constraint failed', 'notNullViolation'],
  ['CHECK constraint failed', 'checkViolation'],
  ['database is locked', 'retryable'],
];

/**
 * Names what `err` ran into on any engine, or `undefined` for anything else. Pure: the error is only
 * read, so it works on any driver error, whether or not a querier saw it first.
 */
export function queryErrorKind(err: unknown): QueryErrorKind | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const { code, errno, number, errorLabels, message }: DriverErrorFields = err;
  const text = typeof message === 'string' ? message : '';
  return (
    SQLSTATE_KINDS.get(code) ??
    SQLSTATE_KINDS.get(errno) ??
    MYSQL_ERRNO_KINDS.get(errno) ??
    (number === 547 && text.includes('CHECK constraint') ? 'checkViolation' : MSSQL_NUMBER_KINDS.get(number)) ??
    MONGO_CODE_KINDS.get(code) ??
    (Array.isArray(errorLabels) && errorLabels.includes('TransientTransactionError') ? 'retryable' : undefined) ??
    SQLITE_MESSAGE_KINDS.find(([fragment]) => text.includes(fragment))?.[1]
  );
}

/**
 * Tags `err` with the query it failed on and hands it back, so `throw enrichError(...)` reads as the
 * control flow it is. `values` are attached only when `logger?.willLogValues()`: they already surface
 * in the logs then, so this opens no new leak.
 */
export function enrichError(
  err: unknown,
  logger: LoggerWrapper | undefined,
  query: string,
  values?: unknown[],
): unknown {
  if (err instanceof Error) {
    const queryError: QueryError = err;
    queryError.query ??= query;
    if (values !== undefined && logger?.willLogValues()) {
      queryError.values ??= values;
    }
  }
  return err;
}
