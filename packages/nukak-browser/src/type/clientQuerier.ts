import { Query, Type, UniversalQuerier, QueryCriteria, QueryOptions, QuerySearch, IdValue, QueryUnique } from 'nukak/type/index.js';
import { ClientRepository } from './clientRepository.js';
import { RequestOptions, RequestSuccessResponse } from './request.js';

export interface ClientQuerier extends UniversalQuerier {
  count<E>(entity: Type<E>, qm?: QuerySearch<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  findOneById<E>(entity: Type<E>, id: IdValue<E>, qm?: QueryUnique<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findOne<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E>>;

  findMany<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E[]>>;

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  insertMany?<E>(entity: Type<E>, payload: E[], opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  updateMany?<E>(entity: Type<E>, qm: QueryCriteria<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<number>>;

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions): Promise<RequestSuccessResponse<IdValue<E>>>;

  saveMany?<E>(entity: Type<E>, payload: E[]): Promise<RequestSuccessResponse<IdValue<E>[]>>;

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: QueryOptions & RequestOptions): Promise<RequestSuccessResponse<number>>;

  getRepository<E>(entity: Type<E>): ClientRepository<E>;
}
