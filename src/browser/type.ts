import { QueryOne, QueryOneFilter, Query, QueryFilter } from '../core/type';
import { IsomorphicRepository } from '../core/repository/type';

export * from '../core/type';

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

export interface ClientRepository<T, ID = any> extends IsomorphicRepository<T, ID> {
  insertOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  updateOneById(id: ID, body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<void>>;
  saveOne(body: T, opts?: RequestOptions): Promise<RequestSuccessResponse<ID>>;
  findOneById(id: ID, qm?: QueryOne<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T>>;
  findOne(qm: QueryOneFilter<T>, opts?: any): Promise<RequestSuccessResponse<T>>;
  find(qm: Query<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<T[]>>;
  removeOneById(id: ID, opts?: RequestOptions): Promise<RequestSuccessResponse<void>>;
  remove(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
  count(filter: QueryFilter<T>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
