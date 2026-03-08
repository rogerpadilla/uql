export type RequestSuccessResponse<E> = {
  data: E;
  count?: number;
};

export type RequestErrorResponse = {
  readonly error: {
    readonly message: string;
    readonly code: number;
  };
};

export type RequestOptions = {
  silent?: boolean;
};

export type RequestFindOptions = RequestOptions & {
  count?: boolean;
};

type RequestBaseNotification = { readonly opts?: RequestOptions };
type RequestSuccessNotification = { readonly phase: 'start' | 'success' | 'complete' } & RequestBaseNotification;
type RequestErrorNotification = { readonly phase: 'error' } & RequestErrorResponse & RequestBaseNotification;
export type RequestNotification = RequestSuccessNotification | RequestErrorNotification;
export type RequestCallback = (msg: RequestNotification) => any;
