import { Query, QueryOne, UniversalRepository, QueryCriteria, FieldValue } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface ClientRepository<E> extends UniversalRepository<E> {
  insertMany?(payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<any[]>>;

  insertOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<any>>;

  updateMany?(payload: E, qm: QueryCriteria<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findOne(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOneById(id: FieldValue<E>, qo: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  deleteMany(qm: QueryCriteria<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  deleteOneById(id: FieldValue<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  count(qm: QueryCriteria<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;
}
