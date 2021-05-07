import { getMeta } from '@uql/core/entity/decorator';
import { Query, QueryFilter, QueryOne } from '@uql/core/type';
import { formatKebabCase } from '@uql/core/util';
import { RequestOptions, RequestFindOptions, Querier } from '../type';
import { get, post, put, remove } from '../http';
import { stringifyQuery, stringifyQueryParameter } from './query.util';

export const querier: Querier = {
  insertOne<T>(type: { new (): T }, body: T, opts?: RequestOptions) {
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return post(basePath, body, opts);
  },

  updateOneById<T>(type: { new (): T }, id: any, body: T, opts?: RequestOptions) {
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return put<number>(`${basePath}/${id}`, body, opts);
  },

  saveOne<T>(type: { new (): T }, body: T, opts?: RequestOptions) {
    const meta = getMeta(type);
    const id = body[meta.id.property];
    if (id) {
      return this.updateOneById(type, id, body, opts).then((res) => {
        return { data: id };
      });
    }
    return this.insertOne(type, body, opts);
  },

  findOne<T>(type: { new (): T }, qm: Query<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return get<T>(`${basePath}/one${qs}`, opts);
  },

  findOneById<T>(type: { new (): T }, id: any, qm: QueryOne<T>, opts?: RequestOptions) {
    const qs = stringifyQuery(qm);
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return get<T>(`${basePath}/${id}${qs}`, opts);
  },

  find<T>(type: { new (): T }, qm: Query<T>, opts?: RequestFindOptions) {
    const data: typeof qm & Pick<typeof opts, 'count'> = { ...qm };
    if (opts?.count) {
      data.count = true;
    }
    const qs = stringifyQuery(data);
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return get<T[]>(`${basePath}${qs}`, opts);
  },

  remove<T>(type: { new (): T }, filter: QueryFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return remove<number>(`${basePath}${qs}`, opts);
  },

  removeOneById<T>(type: { new (): T }, id: any, opts?: RequestOptions) {
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return remove<number>(`${basePath}/${id}`, opts);
  },

  count<T>(type: { new (): T }, filter: QueryFilter<T>, opts?: RequestOptions) {
    const qs = stringifyQueryParameter('filter', filter);
    const meta = getMeta(type);
    const basePath = getBasePath(meta.name);
    return get<number>(`${basePath}/count${qs}`, opts);
  },
};

function getBasePath(name: string) {
  return '/api/' + formatKebabCase(name);
}
