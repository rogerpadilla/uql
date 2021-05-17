import { RequestOptions, RequestSuccessResponse, RequestErrorResponse } from '../type';
import { notify } from './bus';

export function get<T>(url: string, opts?: RequestOptions) {
  return request<T>(url, { method: 'get' }, opts);
}

export function post<T>(url: string, body: Object, opts?: RequestOptions) {
  const stringifiedData = JSON.stringify(body);
  return request<T>(url, { method: 'post', body: stringifiedData }, opts);
}

export function patch<T>(url: string, body: Object, opts?: RequestOptions) {
  const stringifiedData = JSON.stringify(body);
  return request<T>(url, { method: 'patch', body: stringifiedData }, opts);
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

  if (init.method !== 'get' && init.method !== 'head' && init.method !== 'options') {
    // TODO: send auth token to server
    //   Init.headers['csrf-token'] = appState.csrfToken;
  }

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

/*
 *   Export function trackPageView(path: string) {
 *     gtag('config', GA_MEASUREMENT_ID, { page_path: path });
 *   }
 */
