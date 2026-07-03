import type { RequestErrorResponse, RequestSuccessResponse } from '../../http/contract.js';
import type { RequestOptions } from '../type/index.js';
import { notify } from './bus.js';

/**
 * Error thrown for non-2xx responses. Carries the HTTP status so callers can key
 * behavior on it (401 redirects, 402 payment flows, error-boundary routing).
 */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export function get<T>(url: string, opts?: RequestOptions) {
  return request<T>(url, { method: 'get' }, opts);
}

export function post<T>(url: string, payload: unknown, opts?: RequestOptions) {
  const body = JSON.stringify(payload);
  return request<T>(url, { method: 'post', body }, opts);
}

export function patch<T>(url: string, payload: unknown, opts?: RequestOptions) {
  const body = JSON.stringify(payload);
  return request<T>(url, { method: 'patch', body }, opts);
}

export function put<T>(url: string, payload: unknown, opts?: RequestOptions) {
  const body = JSON.stringify(payload);
  return request<T>(url, { method: 'put', body }, opts);
}

export function remove<T>(url: string, opts?: RequestOptions) {
  return request<T>(url, { method: 'delete' }, opts);
}

/**
 * HTTP QUERY (RFC 10008): a safe, idempotent read whose JSON query travels in the
 * request body, avoiding URL-length limits. Method name must stay uppercase
 * (fetch only normalizes the classic verbs).
 */
export function query<T>(url: string, payload: unknown, opts?: RequestOptions) {
  const body = JSON.stringify(payload);
  return request<T>(url, { method: 'QUERY', body }, opts);
}

function request<T>(url: string, init: RequestInit, opts?: RequestOptions) {
  notify({ phase: 'start', opts });

  init.headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...opts?.headers,
  };
  if (opts?.signal) {
    init.signal = opts.signal;
  }

  return fetch(url, init)
    .then((rawResp) =>
      rawResp.json().then((resp: unknown) => {
        const isSuccess = rawResp.status >= 200 && rawResp.status < 300;
        if (isSuccess) {
          notify({ phase: 'success', opts });
          return resp as RequestSuccessResponse<T>;
        }
        const errorResp = resp as Partial<RequestErrorResponse> | undefined;
        const error = {
          message: errorResp?.error?.message ?? rawResp.statusText,
          code: errorResp?.error?.code ?? rawResp.status,
        };
        notify({ phase: 'error', error, opts });
        throw new RequestError(error.message, error.code);
      }),
    )
    .finally(() => {
      notify({ phase: 'complete', opts });
    });
}
