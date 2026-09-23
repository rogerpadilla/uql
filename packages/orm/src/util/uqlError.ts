/**
 * What a failed query ran into, named the same on every engine - what {@link queryErrorKind} answers
 * with, whether a driver raised the error or UQL did. `retryable` is a deadlock, a serialization
 * failure, a lock timeout or a busy database: the transaction can simply run again. `usage` is the
 * caller's own mistake, which running it again will not fix.
 */
export type QueryErrorKind =
  | 'uniqueViolation'
  | 'foreignKeyViolation'
  | 'notNullViolation'
  | 'checkViolation'
  | 'optimisticLock'
  | 'retryable'
  | 'usage';

/**
 * Thrown where the caller used the API in a way no statement can carry out: an update payload with no
 * version, a `$lock` outside a transaction, a method with no version to match. A `TypeError` still,
 * since the call itself is wrong, but one carrying the `status` an HTTP transport answers with - the
 * request is malformed, not the server's failure, and an untyped client is exactly who reaches this.
 */
export class UqlUsageError extends TypeError {
  override name = 'UqlUsageError';
  /** What `queryErrorKind` answers, so a caller branches on it rather than on the class. */
  readonly kind = 'usage';
  /** What an HTTP transport answers with. */
  readonly status = 400;
}

/** What a value is, for a refusal naming what `/http` handed over instead of what the types require. */
export function kindOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/**
 * @deprecated since 0.77.1 - use {@link UqlUsageError}, which every misuse throws, lock or not. The
 * same class under both names, so an existing `instanceof` keeps working.
 */
export const UqlLockUsageError = UqlUsageError;
export type UqlLockUsageError = UqlUsageError;

/**
 * Thrown when an update's `@Field({ version })` no longer matches the row: another writer moved it on,
 * or it is gone. `expected` is what the payload carried, `actual` what the row holds now, `undefined`
 * where there is no row left.
 */
export class UqlOptimisticLockError extends Error {
  override name = 'UqlOptimisticLockError';
  readonly kind = 'optimisticLock';
  readonly status = 409;

  constructor(
    message: string,
    readonly expected: unknown,
    readonly actual: unknown,
  ) {
    super(message);
  }
}
