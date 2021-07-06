import { Query, QueryOne, UniversalRepository, QueryCriteria, FieldValue, QueryOptions, QuerySearch } from '@uql/core/type';
import { RequestOptions, RequestSuccessResponse } from './request';

export interface ClientRepository<E> extends UniversalRepository<E> {
  count(qm: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  findOneById(id: FieldValue<E>, qo: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOne(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  insertOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<any>>;

  insertMany?(payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<any[]>>;

  updateMany?(payload: E, qm: QueryCriteria<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  deleteOneById(id: FieldValue<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;
}
