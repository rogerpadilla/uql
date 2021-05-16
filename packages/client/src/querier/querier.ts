import { getMeta } from '@uql/core/entity/decorator';
import { Query, QueryFilter, QueryOne, Type } from '@uql/core/type';
import { kebabCase } from '@uql/core/util';
import { RequestOptions, RequestFindOptions, QuerierClient } from '../type';
import { get, post, put, remove } from '../http';
import { getBasePathApi } from '../options';
import { stringifyQuery, stringifyQueryParameter } from './query.util';

export class Querier<ID = any> implements QuerierClient {
  insertOne<E>(entity: Type<E>, body: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return post<E>(basePath, body, opts);
  }

  updateOneById<E>(entity: Type<E>, id: ID, body: E, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
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
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return get<E>(`${basePath}/one${qs}`, opts);
  }

  findOneById<E>(entity: Type<E>, id: ID, qm: QueryOne<E>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return get<E>(`${basePath}/${id}${qs}`, opts);
  }

  find<E>(entity: Type<E>, qm: Query<E>, opts?: RequestFindOptions) {
    const data: typeof qm & Pick<typeof opts, 'count'> = { ...qm };
    if (opts?.count) {
      data.count = true;
    }
    const qs = stringifyQuery(data);
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return get<E[]>(`${basePath}${qs}`, opts);
  }

  remove<E>(entity: Type<E>, filter: QueryFilter<E>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return remove<number>(`${basePath}${qs}`, opts);
  }

  removeOneById<E>(entity: Type<E>, id: ID, opts?: RequestOptions) {
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return remove<number>(`${basePath}/${id}`, opts);
  }

  count<E>(entity: Type<E>, filter?: QueryFilter<E>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    const meta = getMeta(entity);
    const basePath = getBasePath(meta.name);
    return get<number>(`${basePath}/count${qs}`, opts);
  }
}

function getBasePath(name: string) {
  return getBasePathApi() + '/' + kebabCase(name);
}
