/**
 * What a failed query ran into, named the same on every engine - what {@link queryErrorKind} answers
 * with, whether a driver raised the error or UQL did. `retryable` is a deadlock, a serialization
 * failure, a lock timeout or a busy database: the transaction can simply run again. `usage` is the
 * caller's own mistake, which running it again will not fix. `security` is a `security` filter refusing.
 */
export const QUERY_ERROR_KINDS = [
  'uniqueViolation',
  'foreignKeyViolation',
  'notNullViolation',
  'checkViolation',
  'optimisticLock',
  'retryable',
  'usage',
  'security',
] as const;

export type QueryErrorKind = (typeof QUERY_ERROR_KINDS)[number];

const KINDS: ReadonlySet<unknown> = new Set(QUERY_ERROR_KINDS);

export function isQueryErrorKind(value: unknown): value is QueryErrorKind {
  return KINDS.has(value);
}

/**
 * Where in a call the refused value sits, as `['query', '$where', 'password']`: a form highlights the field by it. A
 * querier's refusal names it within the query, `['$limit']`, which the API places within the call.
 */
export type UqlErrorPath = readonly (string | number)[];

export type UqlErrorOptions = ErrorOptions & {
  readonly path?: UqlErrorPath;
  /** What HTTP answers beside the status, as a 405's `allow`. */
  readonly headers?: Readonly<Record<string, string>>;
};

/** Every error UQL raises of its own: the kind `queryErrorKind` answers, and the status HTTP answers with. */
export abstract class UqlError extends Error {
  abstract readonly kind: QueryErrorKind;
  abstract readonly status: number;
  declare readonly path?: UqlErrorPath;
  declare readonly headers?: Readonly<Record<string, string>>;

  constructor(message?: string, opts?: UqlErrorOptions) {
    super(message, opts);
    if (opts?.path) {
      this.path = opts.path;
    }
    if (opts?.headers) {
      this.headers = opts.headers;
    }
  }
}

/**
 * Thrown where the caller used the API in a way no statement can carry out: an update payload with no
 * version, a `$lock` outside a transaction, a method with no version to match. A `400` over HTTP: the
 * request is malformed, not the server's failure, and an untyped client is exactly who reaches this.
 */
export class UqlUsageError extends UqlError {
  override name = 'UqlUsageError';
  readonly kind = 'usage';
  readonly status = 400;
}

/**
 * A request refused with a 4xx `status`: what the API answers a route nothing serves (404), a method its op does
 * not take (405, naming the ones it does in `allow`) or a body that is not JSON (415) with, and what a middleware or
 * a hook throws to refuse a client, `new UqlRequestError('unauthorized', 401)`: only a `UqlError` reaches one.
 */
export class UqlRequestError extends UqlError {
  override name = 'UqlRequestError';
  readonly kind = 'usage';

  constructor(
    message: string,
    readonly status: number,
    opts?: UqlErrorOptions,
  ) {
    super(message, opts);
  }
}

/**
 * Thrown where a `security` filter refuses: its context is missing, or a write would leave a row outside it.
 * Fails the statement closed.
 */
export class UqlSecurityError extends UqlError {
  override name = 'UqlSecurityError';
  readonly kind = 'security';
  readonly status = 403;
}

/** What a value is, for a refusal naming what `/http` handed over instead of what the types require. */
export function kindOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/**
 * Thrown when an update's `f.version()` column no longer matches the row: another writer moved it on,
 * or it is gone. `expected` is what the payload carried, `actual` what the row holds now, `undefined`
 * where there is no row left.
 */
export class UqlOptimisticLockError extends UqlError {
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
