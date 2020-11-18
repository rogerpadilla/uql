import { QueryOne, Query, QueryFilter, IsomorphicRepository } from 'uql/type';

export interface RequestSuccessResponse<T> {
  data: T;
}

export interface RequestErrorResponse {
  readonly error: {
    readonly message: string;
    readonly code: number;
  };
}

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

export interface HttpRepository<T, ID = any> extends IsomorphicRepository<T, ID> {
  insertOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  updateOneById(id: ID, body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
  saveOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  find(qm: Query<T>, opts?: RequestFindOptions): Promise<RequestSuccessResponse<T[]>>;
  findOne(qm: Query<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>>;
  findOneById(id: ID, qo?: QueryOne<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>>;
  remove(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
  removeOneById(id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
  count(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
