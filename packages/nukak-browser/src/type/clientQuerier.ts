import type { Type, UniversalQuerier, QueryOptions, IdValue, QueryOne, QuerySearch, Query } from 'nukak/type';
import type { ClientRepository } from './clientRepository.js';
import type { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientQuerier extends UniversalQuerier {
  findOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    project?: QueryOne<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E>>;

  findOne<E>(entity: Type<E>, q: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany<E>(entity: Type<E>, q: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  count<E>(entity: Type<E>, qm?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  updateOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    payload: E,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    opts?: QueryOptions & RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E>>>;

  deleteMany<E>(
    entity: Type<E>,
    qm: QuerySearch<E>,
    opts?: QueryOptions & RequestOptions,
  ): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  getRepository<E>(entity: Type<E>): ClientRepository<E>;
}
