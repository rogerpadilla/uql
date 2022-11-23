import { getMeta } from 'nukak/entity/decorator/definition.js';
import { IdValue, Query, QueryCriteria, QueryOne, QueryOptions, QuerySearch, QueryUnique, Type } from 'nukak/type/index.js';
import { kebabCase } from 'nukak/util/index.js';
import { RequestOptions, RequestFindOptions, ClientQuerier, ClientRepository } from '../type/index.js';
import { get, post, patch, remove } from '../http/index.js';
import { stringifyQuery } from './querier.util.js';
import { GenericClientRepository } from './genericClientRepository.js';

export class HttpQuerier implements ClientQuerier {
  constructor(readonly basePath: string) {}

  count<E>(entity: Type<E>, qm: QuerySearch<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<number>(`${basePath}/count${qs}`, opts);
  }

  findOneById<E>(entity: Type<E>, id: IdValue<E>, qm: QueryUnique<E> = {}, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<E>(`${basePath}/${id}${qs}`, opts);
  }

  findOne<E>(entity: Type<E>, qm: QueryOne<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<E>(`${basePath}/one${qs}`, opts);
  }

  findMany<E>(entity: Type<E>, qm: Query<E>, opts?: RequestFindOptions) {
    const data: typeof qm & Pick<typeof opts, 'count'> = { ...qm };
    if (opts?.count) {
      data.count = true;
    }
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(data);
    return get<E[]>(`${basePath}${qs}`, opts);
  }

  findManyAndCount<E>(entity: Type<E>, qm: Query<E>, opts?: RequestFindOptions) {
    return this.findMany(entity, qm, { ...opts, count: true });
  }

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<any>(basePath, payload, opts);
  }

  updateOneById<E>(entity: Type<E>, id: IdValue<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return patch<number>(`${basePath}/${id}`, payload, opts);
  }

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const id = payload[meta.id];
    if (id) {
      return this.updateOneById(entity, id, payload, opts).then(() => ({ data: id }));
    }
    return this.insertOne(entity, payload, opts);
  }

  deleteOneById<E>(entity: Type<E>, id: IdValue<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = opts.softDelete ? stringifyQuery({ softDelete: opts.softDelete }) : '';
    return remove<number>(`${basePath}/${id}${qs}`, opts);
  }

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts: QueryOptions & RequestOptions = {}) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(opts.softDelete ? { ...qm, softDelete: opts.softDelete } : qm);
    return remove<number>(`${basePath}${qs}`, opts);
  }

  getRepository<E>(entity: Type<E>): ClientRepository<E> {
    return new GenericClientRepository(entity, this);
  }

  getBasePath<E>(entity: Type<E>) {
    return this.basePath + '/' + kebabCase(entity.name);
  }
}
