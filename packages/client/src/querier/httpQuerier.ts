import { getMeta } from '@uql/core/entity/decorator';
import { Query, QueryFilter, QueryOne, Type } from '@uql/core/type';
import { kebabCase } from '@uql/core/util';
import { RequestOptions, RequestFindOptions, ClientQuerier } from '../type';
import { get, post, put, remove } from '../http';
import { getBasePathApi } from '../options';
import { stringifyQuery, stringifyQueryParameter } from './query.util';

export class HttpQuerier<ID = any> implements ClientQuerier<ID> {
  insertOne<E>(entity: Type<E>, body: E, opts?: RequestOptions) {
    const basePath = getBasePath(entity);
    return post<ID>(basePath, body, opts);
  }

  updateOneById<E>(entity: Type<E>, id: ID, body: E, opts?: RequestOptions) {
    const basePath = getBasePath(entity);
    return put<number>(`${basePath}/${id}`, body, opts);
  }

  saveOne<E>(entity: Type<E>, body: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const id = body[meta.id.property];
    if (id) {
      return this.updateOneById(entity, id, body, opts).then((res) => {
        return { data: id };
      });
    }
    return this.insertOne(entity, body, opts);
  }

  findOne<E>(entity: Type<E>, qm: Query<E>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    const basePath = getBasePath(entity);
    return get<E>(`${basePath}/one${qs}`, opts);
  }

  findOneById<E>(entity: Type<E>, id: ID, qm: QueryOne<E>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    const basePath = getBasePath(entity);
    return get<E>(`${basePath}/${id}${qs}`, opts);
  }

  find<E>(entity: Type<E>, qm: Query<E>, opts?: RequestFindOptions) {
    const data: typeof qm & Pick<typeof opts, 'count'> = { ...qm };
    if (opts?.count) {
      data.count = true;
    }
    const qs = stringifyQuery(data);
    const basePath = getBasePath(entity);
    return get<E[]>(`${basePath}${qs}`, opts);
  }

  remove<E>(entity: Type<E>, filter: QueryFilter<E>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    const basePath = getBasePath(entity);
    return remove<number>(`${basePath}${qs}`, opts);
  }

  removeOneById<E>(entity: Type<E>, id: ID, opts?: RequestOptions) {
    const basePath = getBasePath(entity);
    return remove<number>(`${basePath}/${id}`, opts);
  }

  count<E>(entity: Type<E>, filter?: QueryFilter<E>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    const basePath = getBasePath(entity);
    return get<number>(`${basePath}/count${qs}`, opts);
  }
}

function getBasePath<E>(entity: Type<E>) {
  return getBasePathApi() + '/' + kebabCase(entity.name);
}
