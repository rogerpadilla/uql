const QUERY_LOCK_WAITS = ['block', 'nowait', 'skip'] as const;

/**
 * What to do about a row someone else already holds. `block` (the default) waits for them; `nowait`
 * fails the statement at once; `skip` leaves the row out of the result, which is what makes a
 * work-queue possible: each worker takes rows nobody else has.
 */
export type QueryLockWait = (typeof QUERY_LOCK_WAITS)[number];

/**
 * `true` takes the lock and waits for anyone holding the rows; the object form chooses what to do
 * instead of waiting. `false` takes none, so a query built conditionally needs no branch.
 */
export type QueryLock = boolean | { readonly wait?: QueryLockWait };

function isOneOf<T extends string>(vals: readonly T[], val: unknown): val is T {
  return (vals as readonly unknown[]).includes(val);
}

/**
 * The wait policy this lock resolves to, or `undefined` when there is no lock. An unknown policy
 * throws here rather than reaching a dialect, so the message names what the caller wrote instead of
 * the SQL it would have produced.
 */
export function parseQueryLock(lock: QueryLock | undefined): QueryLockWait | undefined {
  if (lock === undefined || lock === false) {
    return undefined;
  }
  const wait = lock === true ? 'block' : (lock?.wait ?? 'block');
  if (!isOneOf(QUERY_LOCK_WAITS, wait)) {
    throw new TypeError(`unknown $lock wait policy: ${String(wait)}`);
  }
  return wait;
}
