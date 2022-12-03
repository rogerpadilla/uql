import { RequestOptions, RequestSuccessResponse, RequestErrorResponse } from '../type/index.js';
import { notify } from './bus.js';

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

function request<T>(url: string, init: RequestInit, opts?: RequestOptions) {
  notify({ phase: 'start', opts });

  init.headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };

  return fetch(url, init)
    .then((rawResp) =>
      rawResp.json().then((resp: RequestSuccessResponse<T> | RequestErrorResponse) => {
        const isSuccess = rawResp.status >= 200 && rawResp.status < 300;
        if (isSuccess) {
          notify({ phase: 'success', opts });
          return resp as RequestSuccessResponse<T>;
        }
        const errorResp = resp as RequestErrorResponse;
        notify({
          phase: 'error',
          error: errorResp.error,
          opts,
        });
        throw Error(errorResp.error.message);
      })
    )
    .finally(() => {
      notify({ phase: 'complete', opts });
    });
}
