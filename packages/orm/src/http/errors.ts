import { queryErrorKind } from '../querier/queryError.js';
import { type QueryErrorKind, UqlError, type UqlErrorPath } from '../util/uqlError.js';

/** A failure as JSON carries it: the HTTP status, what kind of failure it is, and where in the call it sits. */
export type RequestFailure = {
  readonly message: string;
  readonly status: number;
  readonly kind?: QueryErrorKind;
  readonly path?: UqlErrorPath;
};

export type RequestErrorResponse = { readonly error: RequestFailure };

/** Generic on purpose: a driver's message names tables and constraints, and Postgres echoes the value. */
const KIND_ERRORS: ReadonlyMap<QueryErrorKind | undefined, RequestFailure> = new Map(
  (
    [
      ['uniqueViolation', 'Conflict', 409],
      ['foreignKeyViolation', 'Conflict', 409],
      ['notNullViolation', 'Bad Request', 400],
      ['checkViolation', 'Bad Request', 400],
      ['retryable', 'Service Unavailable', 503],
    ] as const
  ).map(([kind, message, status]) => [kind, { message, status, kind }] as const),
);

const INTERNAL_ERROR: RequestFailure = { message: 'Internal Server Error', status: 500 };

/**
 * `err` as a client may see it: a `UqlError` whole, anything else by its kind alone, generically. A `status` on any
 * other error is not taken: an HTTP driver's (libSQL's) comes with a message naming tables.
 */
function failureOf(err: unknown): RequestFailure {
  if (err instanceof UqlError) {
    return { message: err.message, status: err.status, kind: err.kind, ...(err.path && { path: err.path }) };
  }
  return KIND_ERRORS.get(queryErrorKind(err)) ?? INTERNAL_ERROR;
}

/** What a transport answers: a status, a JSON body, and any header it calls for. */
export type HandlerResponse<Body = unknown> = {
  readonly status: number;
  readonly body: Body;
  readonly headers?: Readonly<Record<string, string>>;
};

export type ErrorResponse = HandlerResponse<RequestErrorResponse>;

/** A thrown error as the status, `{ error }` body and headers a transport answers with, a `UqlError`'s own headers included. */
export function toErrorResponse(err: unknown): ErrorResponse {
  const error = failureOf(err);
  const headers = err instanceof UqlError ? err.headers : undefined;
  return { status: error.status, body: { error }, ...(headers && { headers }) };
}
