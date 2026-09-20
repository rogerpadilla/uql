import { UqlUsageError } from '../util/uqlError.js';

const QUERY_LOCK_WAITS = ['nowait', 'skip'] as const;

/**
 * What to do about a row someone else already holds. `block` (what `true` asks for) waits for them;
 * `nowait` fails the statement at once; `skip` leaves the row out of the result, which is what makes a
 * work-queue possible: each worker takes rows nobody else has.
 */
export type QueryLockWait = 'block' | (typeof QUERY_LOCK_WAITS)[number];

/**
 * `true` takes the lock and waits for anyone holding the rows; `$wait` chooses what to do instead of
 * waiting. `false` takes none, so a query built conditionally needs no branch.
 */
export type QueryLock = boolean | { readonly $wait: (typeof QUERY_LOCK_WAITS)[number] };

function isOneOf<T extends string>(vals: readonly T[], val: unknown): val is T {
  return (vals as readonly unknown[]).includes(val);
}

/**
 * The wait policy this lock resolves to, or `undefined` when there is no lock. An unknown policy
 * throws here rather than reaching a dialect, so the message names what the caller wrote instead of
 * the SQL it would have produced.
 */
export function parseQueryLock(lock: QueryLock | undefined): QueryLockWait | undefined {
  if (!lock) {
    return undefined;
  }
  if (lock === true) {
    return 'block';
  }
  if (!isOneOf(QUERY_LOCK_WAITS, lock.$wait)) {
    throw new UqlUsageError(`unknown $lock wait policy: ${String(lock.$wait)}`);
  }
  return lock.$wait;
}
