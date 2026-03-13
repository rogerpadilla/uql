import { getMeta } from '../../entity/index.js';
import type {
  IdKey,
  IdValue,
  Query,
  QueryOne,
  QueryOptions,
  QuerySearch,
  Type,
  UpdatePayload,
} from '../../type/index.js';
import { kebabCase } from '../../util/index.js';
import { get, patch, post, remove } from '../http/index.js';
import type { ClientQuerier, RequestFindOptions, RequestOptions, RequestSuccessResponse } from '../type/index.js';
import { stringifyQuery } from './querier.util.js';

export class HttpQuerier implements ClientQuerier {
  constructor(readonly basePath: string) {}

  findOneById<E>(
    entity: Type<E>,
    id: IdValue<E>,
    q?: QueryOne<E>,
    opts?: RequestOptions,
  ): Promise<RequestSuccessResponse<E | undefined>> {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return get<E | undefined>(`${basePath}/${id}${qs}`, opts);
  }

  findOne<E>(entity: Type<E>, q: QueryOne<E>, opts?: RequestOptions): Promise<RequestSuccessResponse<E | undefined>> {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return get<E | undefined>(`${basePath}/one${qs}`, opts);
  }

  findMany<E>(entity: Type<E>, q: Query<E>, opts?: RequestFindOptions) {
    const data: Query<E> & { count?: boolean } = { ...q };
    if (opts?.count) {
      data.count = true;
    }
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(data);
    return get<E[]>(`${basePath}${qs}`, opts);
  }

  findManyAndCount<E>(entity: Type<E>, q: Query<E>, opts?: RequestFindOptions) {
    return this.findMany(entity, q, { ...opts, count: true });
  }

  count<E>(entity: Type<E>, q: QuerySearch<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(q);
    return get<number>(`${basePath}/count${qs}`, opts);
  }

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<IdValue<E>>(basePath, payload, opts);
  }

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: UpdatePayload<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return patch<number>(`${basePath}/${id}`, payload, opts);
  }

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const idKey = meta.id ?? ('id' as IdKey<E>);
    const id = payload[idKey];
    if (id) {
      return this.updateOneById(entity, id, payload as UpdatePayload<E>, opts).then(() => ({ data: id }));
    }
    return this.insertOne(entity, payload, opts);
  }

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = opts.softDelete ? stringifyQuery({ softDelete: opts.softDelete }) : '';
    return remove<number>(`${basePath}/${id}${qs}`, opts);
  }

  deleteMany<E>(entity: Type<E>, q: QuerySearch<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(opts.softDelete ? { ...q, softDelete: opts.softDelete } : q);
    return remove<number>(`${basePath}${qs}`, opts);
  }

  getBasePath<E>(entity: Type<E>) {
    return this.basePath + '/' + kebabCase(entity.name);
  }
}
