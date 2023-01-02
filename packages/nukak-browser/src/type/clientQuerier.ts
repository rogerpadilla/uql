import type { Type, UniversalQuerier, QueryOptions, IdValue, QueryProject, Merge, QueryOne, QuerySearch, QueryCriteria } from 'nukak/type';
import type { ClientRepository } from './clientRepository.js';
import type { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientQuerier extends UniversalQuerier {
  findOneById<E, P extends QueryProject<E>>(
    entity: Type<E>,
    id: IdValue<E>,
    project?: P,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<Merge<E, P>>>;

  findOne<E, P extends QueryProject<E>>(
    entity: Type<E>,
    qm: QueryOne<E>,
    project?: P,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<Merge<E, P>>>;

  findMany<E, P extends QueryProject<E>>(
    entity: Type<E>,
    qm: QueryCriteria<E>,
    project?: P,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<Merge<E, P>[]>>;

  findManyAndCount<E, P extends QueryProject<E>>(
    entity: Type<E>,
    qm: QueryCriteria<E>,
    project?: P,
    opts?: RequestOptions
  ): Promise<RequestSuccessResponse<Merge<E, P>[]>>;

  count<E>(entity: Type<E>, qm?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  insertMany?<E>(entity: Type<E>, payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  updateMany?<E>(entity: Type<E>, qm: QuerySearch<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveMany?<E>(entity: Type<E>, payload: E[]): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;

  deleteMany<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;

  getRepository<E>(entity: Type<E>): ClientRepository<E>;
}
