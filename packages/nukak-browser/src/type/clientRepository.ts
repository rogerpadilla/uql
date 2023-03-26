import type { UniversalRepository, QueryOptions, IdValue, QueryProject, Merge, QuerySearch, QueryCriteria, QueryOneCriteria } from 'nukak/type';
import type { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientRepository<E> extends UniversalRepository<E> {
  findOneById<P extends QueryProject<E>>(id: IdValue<E>, project?: P, opts?: RequestOptions): Promise<RequestSuccessResponse<Merge<E, P>>>;

  findOne<P extends QueryProject<E>>(qm: QueryOneCriteria<E>, project?: P, opts?: RequestOptions): Promise<RequestSuccessResponse<Merge<E, P>>>;

  findMany<P extends QueryProject<E>>(qm: QueryCriteria<E>, project?: P, opts?: RequestOptions): Promise<RequestSuccessResponse<Merge<E, P>[]>>;

  findManyAndCount<P extends QueryProject<E>>(
    qm: QueryCriteria<E>,
    project?: P,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<Merge<E, P>[]>>;

  count(qm?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  insertOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteOneById(id: IdValue<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;
}
