import { getMeta } from '@uql/core/entity/decorator';
import { FieldValue, Query, QueryCriteria, QueryOne, Type } from '@uql/core/type';
import { kebabCase } from '@uql/core/util';
import { RequestOptions, RequestFindOptions, ClientQuerier, ClientRepository } from '../type';
import { get, post, patch, remove } from '../http';
import { stringifyQuery } from './querier.util';
import { BaseClientRepository } from './baseClientRepository';

export class HttpQuerier implements ClientQuerier {
  constructor(readonly basePath: string) {}

  getBasePath<E>(entity: Type<E>) {
    return this.basePath + '/' + kebabCase(entity.name);
  }

  insertOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<any>(basePath, payload, opts);
  }

  updateOneById<E>(entity: Type<E>, payload: E, id: FieldValue<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return patch<number>(`${basePath}/${id}`, payload, opts);
  }

  saveOne<E>(entity: Type<E>, payload: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const id = payload[meta.id];
    if (id) {
      return this.updateOneById(entity, payload, id, opts).then(() => ({ data: id }));
    }
    return this.insertOne(entity, payload, opts);
  }

  findOne<E>(entity: Type<E>, qm: QueryOne<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<E>(`${basePath}/one${qs}`, opts);
  }

  findOneById<E>(entity: Type<E>, id: FieldValue<E>, qm: QueryOne<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<E>(`${basePath}/${id}${qs}`, opts);
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

  deleteMany<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return remove<number>(`${basePath}${qs}`, opts);
  }

  deleteOneById<E>(entity: Type<E>, id: FieldValue<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return remove<number>(`${basePath}/${id}`, opts);
  }

  count<E>(entity: Type<E>, qm: QueryCriteria<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<number>(`${basePath}/count${qs}`, opts);
  }

  getRepository<E>(entity: Type<E>): ClientRepository<E> {
    return new BaseClientRepository(entity, this);
  }
}
