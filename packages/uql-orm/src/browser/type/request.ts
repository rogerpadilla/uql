import type { RequestErrorResponse } from '../../http/contract.js';

export type RequestOptions = {
  silent?: boolean;
  /**
   * extra headers merged over the defaults (e.g. `{ Authorization: 'Bearer ...' }`).
   */
  headers?: Record<string, string>;
  /**
   * abort/timeout control, e.g. `AbortSignal.timeout(120_000)` for long-running calls.
   */
  signal?: AbortSignal;
};

export type RequestFindOptions = RequestOptions & {
  count?: boolean;
};

type RequestBaseNotification = { readonly opts?: RequestOptions };
type RequestSuccessNotification = { readonly phase: 'start' | 'success' | 'complete' } & RequestBaseNotification;
type RequestErrorNotification = { readonly phase: 'error' } & RequestErrorResponse & RequestBaseNotification;
export type RequestNotification = RequestSuccessNotification | RequestErrorNotification;
export type RequestCallback = (msg: RequestNotification) => void;
