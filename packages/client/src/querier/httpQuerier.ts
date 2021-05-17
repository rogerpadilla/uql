import { getMeta } from '@uql/core/entity/decorator';
import { Query, QueryFilter, QueryOne, Type } from '@uql/core/type';
import { kebabCase } from '@uql/core/util';
import { RequestOptions, RequestFindOptions, ClientQuerier, ClientRepository } from '../type';
import { get, post, patch, remove } from '../http';
import { stringifyQuery, stringifyQueryParameter } from './query.util';
import { BaseClientRepository } from './baseClientRepository';

export class HttpQuerier<ID = any> implements ClientQuerier<ID> {
  constructor(readonly basePath: string) {}

  getRepository<E>(entity: Type<E>): ClientRepository<E, ID> {
    return new BaseClientRepository<E, ID>(this, entity);
  }

  getBasePath<E>(entity: Type<E>) {
    return this.basePath + '/' + kebabCase(entity.name);
  }

  insertOne<E>(entity: Type<E>, body: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return post<ID>(basePath, body, opts);
  }

  updateOneById<E>(entity: Type<E>, id: ID, body: E, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return patch<number>(`${basePath}/${id}`, body, opts);
  }

  saveOne<E>(entity: Type<E>, body: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const id = body[meta.id.property];
    if (id) {
      return this.updateOneById(entity, id, body, opts).then(() => {
        return { data: id };
      });
    }
    return this.insertOne(entity, body, opts);
  }

  findOne<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQuery(qm);
    return get<E>(`${basePath}/one${qs}`, opts);
  }

  findOneById<E>(entity: Type<E>, id: ID, qm: QueryOne<E>, opts?: RequestOptions) {
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

  removeMany<E>(entity: Type<E>, filter: QueryFilter<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQueryParameter('filter', filter);
    return remove<number>(`${basePath}${qs}`, opts);
  }

  removeOneById<E>(entity: Type<E>, id: ID, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    return remove<number>(`${basePath}/${id}`, opts);
  }

  count<E>(entity: Type<E>, filter?: QueryFilter<E>, opts?: RequestOptions) {
    const basePath = this.getBasePath(entity);
    const qs = stringifyQueryParameter('filter', filter);
    return get<number>(`${basePath}/count${qs}`, opts);
  }
}
