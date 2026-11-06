import type { RequestFailure } from '../../http/errors.js';
import { encodeCall, type ReadMethod } from '../../http/route.js';
import { isRecord } from '../../util/object.util.js';
import { isQueryErrorKind, type QueryErrorKind, type UqlErrorPath } from '../../util/uqlError.js';
import type { ClientTransport } from '../type/index.js';

/**
 * A failed call, as the API answered it: its HTTP status, what kind of failure it is (`queryErrorKind`'s), and where
 * in the call the refused value sits, so a form can point at the field.
 */
export class RequestError extends Error implements RequestFailure {
  override name = 'RequestError';
  readonly status: number;
  declare readonly kind?: QueryErrorKind;
  declare readonly path?: UqlErrorPath;

  constructor({ message, status, ...where }: RequestFailure) {
    super(message);
    this.status = status;
    Object.assign(this, where);
  }
}

export type HttpTransportOptions = {
  /**
   * Headers sent with every request, merged under per-call headers: a project key, the user's `Authorization`.
   * Create one transport per request (e.g. during SSR) to scope auth headers safely.
   */
  readonly headers?: Record<string, string>;
  /**
   * How reads travel: `GET` (the default) caches and needs nothing of any proxy; `QUERY` (RFC 10008) and `POST` carry
   * the call in the body, past a URL's length limit, and `QUERY` needs infrastructure that forwards the method.
   */
  readonly readMethod?: ReadMethod;
};

/** Calls an API mounted at `baseUrl` (e.g. `'/api/v1'`) with `fetch`. */
export function httpTransport(baseUrl: string, defaults: HttpTransportOptions = {}): ClientTransport {
  return async (call, opts) => {
    const { method, path, body } = encodeCall(call, defaults.readMethod);
    // A content type only with a body: on a GET it is not a CORS-safelisted header, so it would cost a preflight.
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...defaults.headers,
        ...opts?.headers,
      },
      ...(body !== undefined && { body }),
      ...(opts?.signal && { signal: opts.signal }),
    });
    const answer: unknown = await response.json().catch(() => undefined);
    // A success is the API's only as its envelope: an HTML page a wrong base URL lands on is none.
    if (response.ok) {
      if (isRecord(answer)) {
        return answer['data'];
      }
      throw new RequestError({
        message: "the response is no API answer: no JSON '{ data }' envelope",
        status: response.status,
      });
    }
    throw failureOf(answer, response);
  };
}

function isErrorPath(value: unknown): value is UqlErrorPath {
  return Array.isArray(value) && value.every((key) => typeof key === 'string' || typeof key === 'number');
}

function failureOf(answer: unknown, response: Response): RequestError {
  const error = isRecord(answer) && isRecord(answer['error']) ? answer['error'] : {};
  const { message, status, kind, path } = error;
  return new RequestError({
    message: typeof message === 'string' ? message : response.statusText,
    status: typeof status === 'number' ? status : response.status,
    ...(isQueryErrorKind(kind) && { kind }),
    ...(isErrorPath(path) && { path }),
  });
}
