import { Query, UniversalRepository, QueryCriteria, QueryOptions, QuerySearch, IdValue, QueryUnique } from 'nukak/type';
import { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientRepository<E> extends UniversalRepository<E> {
  count(qm: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  findOneById(id: IdValue<E>, qm?: QueryUnique<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOne(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount(qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  insertOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  insertMany?(payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  updateMany?(payload: E, qm: QueryCriteria<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveMany?(payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  deleteOneById(id: IdValue<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;

  deleteMany(qm: QueryCriteria<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;
}
