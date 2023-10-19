import type {
  UniversalRepository,
  QueryOptions,
  IdValue,
  QueryProject,
  QuerySearch,
  QueryCriteria,
  QueryOneCriteria,
} from 'nukak/type';
import type { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientRepository<E> extends UniversalRepository<E> {
  findOneById(id: IdValue<E>, project?: QueryProject<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOne(
    qm: QueryOneCriteria<E>,
    project?: QueryProject<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E>>;

  findMany(
    qm: QueryCriteria<E>,
    project?: QueryProject<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount(
    qm: QueryCriteria<E>,
    project?: QueryProject<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E[]>>;

  count(qm?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  insertOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveOne(payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteOneById(id: IdValue<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteMany(qm: QuerySearch<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;
}
